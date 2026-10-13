// Mesurer l'agent sur le jeu d'évaluation du chapitre 8 : pour chaque question, ce que l'agent a fait (recherches,
// autres outils, tours, tokens) et, pour une question couverte, si un passage qui répond (pertinence 2) figure parmi
// ceux que ses recherches lui ont rendus. Le pipeline figé du chapitre 9 en trouvait un dans ses 8 premiers pour 51
// questions couvertes sur 52 : l'agent fait-il mieux, ou décide-t-il parfois de ne pas chercher ?
// Lancement : npm run eval:agent -- [--date 2026-10-13] [--tours 5] [--traces eval/traces/agent.json]
//             [--prompt prompts/rhea-agent.md] (comparer deux versions du prompt, sur tout le jeu)
//             [--recherche secours] (libre : le LLM décide seul ; office : le code cherche d'abord ; secours : le code
//             cherche si le LLM n'a appelé aucun outil) [--sources fichiers] (leçon 7 : les outils d'un agent de code sur
//             donnees/textes, à la place de chercher_documents, prompt prompts/rhea-fichiers.md, recherche libre)
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { agir, TOURS_MAX, type Recherche } from "../agent/boucle.ts";
import { chercherDocuments } from "../agent/chercher.ts";
import { DOSSIER_TEXTES, outilsFichiers } from "../agent/fichiers.ts";
import { creerLlmAgent } from "../agent/llm-agent.ts";
import { calculerIndemniteKm, consulterProfil, consulterSolde, ouvrirTicket } from "../agent/outils-rh.ts";
import { fichiersCites, sourcesCitees } from "../agent/sources.ts";
import { config } from "../config.ts";
import { pool } from "../db.ts";
import type { FichierAgent, TraceAgent } from "../eval/agent.ts";
import { lireJeu } from "../eval/jeu.ts";
import { PASSAGES_DEMANDES } from "../generation/prompt.ts";
import { lirePromptSysteme } from "../generation/systeme.ts";
import { creerLlm } from "../llm.ts";
import { condenser, type Echange } from "../recherche/conversation.ts";
import { aujourdhui, trouverPassages } from "../recherche/passages.ts";
import type { Resultat } from "../recherche/vectorielle.ts";

const { values } = parseArgs({
  allowNegative: true,
  options: {
    date: { type: "string", default: aujourdhui() },
    tours: { type: "string", default: String(TOURS_MAX) },
    traces: { type: "string", default: "eval/traces/agent.json" },
    prompt: { type: "string" },
    sources: { type: "string", default: "documents" }, // documents (la recherche de Rhéa) ou fichiers (leçon 7)
    recherche: { type: "string", default: "secours" }, // libre, office ou secours : qui décide de la première recherche
  },
});
const toursMax = Number(values.tours);
if (!["libre", "office", "secours"].includes(values.recherche)) throw new Error("--recherche attend libre, office ou secours");
if (!["documents", "fichiers"].includes(values.sources)) throw new Error("--sources attend documents ou fichiers");
const surFichiers = values.sources === "fichiers";
if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date) || !Number.isInteger(toursMax) || toursMax < 1) {
  throw new Error("Attendu : --date au format AAAA-MM-JJ, --tours entier positif");
}

const systeme = await lirePromptSysteme(values.prompt ?? (surFichiers ? "prompts/rhea-fichiers.md" : "prompts/rhea-agent.md"));
// Les outils de Rhéa, sans salarié connecté : les questions du jeu ne parlent de la situation de personne. Un ticket
// demandé par erreur ne s'ouvrirait pas : sans salarié, l'outil ne fait rien
// Leçon 7 : sur fichiers, les trois outils d'un agent de code remplacent la recherche de Rhéa
const recherches = surFichiers ? outilsFichiers(DOSSIER_TEXTES) : [chercherDocuments((requete, date) => trouverPassages(pool, requete, PASSAGES_DEMANDES, date))];
const outils = [
  ...recherches,
  consulterSolde(pool),
  consulterProfil(pool),
  calculerIndemniteKm(),
  ouvrirTicket(pool),
];
const llmSimple = creerLlm(); // le LLM sans outils, pour condenser une question de suite (chapitre 9)
const agent = {
  llm: creerLlmAgent(),
  outils,
  systeme: systeme.texte,
  toursMax,
  // La recherche imposée passe par chercher_documents : sur fichiers, le LLM décide seul
  recherche: (surFichiers ? "libre" : values.recherche) as Recherche,
  condenser: (question: string, historique: Echange[]) => condenser(question, historique, llmSimple),
};

const traces: TraceAgent[] = [];
// Les outils qui cherchent dans la documentation, vecteurs ou fichiers
const NOMS_RECHERCHE = new Set(["chercher_documents", "chercher_texte", "lire_fichier", "lister_fichiers"]);
const jeu = await lireJeu();
try {
  for (const q of jeu) {
    const debut = performance.now();
    const vus: Resultat[] = [];
    const trace: TraceAgent = { id: q.id, categorie: q.categorie, question: q.question, appels: [], tours: 0, dernierTour: false, succes: null, documents: [], succesDocument: null, cites: [], inventees: [], tokens: 0, secondes: 0, reponse: "", resultats: [] };
    const documents = new Set<string>();
    const historique = q.categorie === "couverte" ? (q.historique ?? []) : [];
    for await (const etape of agir(q.question, agent, { date: q.date ?? values.date }, historique)) {
      if (etape.type === "appel") trace.appels.push({ id: etape.appel.id, nom: etape.appel.nom, arguments: etape.appel.arguments });
      else if (etape.type === "resultat") {
        vus.push(...(etape.resultat.passages ?? []));
        trace.resultats.push(etape.resultat.texte); // ce que le LLM a lu : npm run eval:agent:juger le donne au juge
        for (const p of etape.resultat.passages ?? []) documents.add(p.document);
        // Sur fichiers : les fichiers des lignes trouvées (« FAQ-RH.md:12: … ») et ceux qui ont été lus
        for (const m of etape.resultat.texte.matchAll(/^([A-Z0-9-]+)\.md(?:, lignes|:\d+:)/gm)) documents.add(m[1]);
      }
      else if (etape.type === "limite") trace.dernierTour = true;
      else {
        // Les sources citées : des passages, ou, sur fichiers, des fichiers lus ou trouvés
        const { cites, inventees } = surFichiers
          ? (({ cites, inventes }) => ({ cites, inventees: inventes }))(fichiersCites(etape.texte, documents))
          : (({ citees, inventees }) => ({ cites: citees.map((p) => p.id), inventees }))(sourcesCitees(etape.texte, vus));
        Object.assign(trace, { tours: etape.tour, reponse: etape.texte.trim(), cites, inventees, tokens: etape.usage.entree + etape.usage.sortie });
      }
    }
    trace.documents = [...documents];
    if (q.categorie === "couverte") {
      trace.succes = vus.some((p) => q.passages[p.id] === 2);
      const attendus = new Set(Object.entries(q.passages).filter(([, n]) => n === 2).map(([id]) => id.split("#")[0]));
      trace.succesDocument = trace.documents.some((d) => attendus.has(d));
    }
    trace.secondes = Math.round((performance.now() - debut) / 100) / 10;
    traces.push(trace);
    const n = trace.appels.filter((a) => NOMS_RECHERCHE.has(a.nom)).length;
    const autres = trace.appels.filter((a) => !NOMS_RECHERCHE.has(a.nom)).map((a) => a.nom);
    // Sur fichiers, pas de passages : le verdict porte sur les documents vus
    const reussi = surFichiers ? trace.succesDocument : trace.succes;
    const verdict = reussi === null ? "" : reussi ? " trouvé" : " MANQUÉ";
    console.log(`${q.id} ${q.categorie.padEnd(11)} ${n} recherche(s)${autres.length ? ` + ${autres.join(", ")}` : ""}, ${trace.tours} tour(s)${verdict}`);
  }
} finally {
  await pool.end();
}

// Le bilan
const couvertes = traces.filter((t) => t.categorie === "couverte");
const autres = traces.filter((t) => t.categorie !== "couverte");
const nbRecherches = (t: TraceAgent) => t.appels.filter((a) => NOMS_RECHERCHE.has(a.nom)).length;
const compte = (liste: TraceAgent[], f: (t: TraceAgent) => boolean) => liste.filter(f).length;
const moyenne = (liste: number[]) => (liste.reduce((s, n) => s + n, 0) / Math.max(1, liste.length)).toFixed(1);
const office = `, recherche ${agent.recherche}, sources : ${values.sources}`;
console.log(`\nAgent (prompt v${systeme.version} ${systeme.empreinte}, ${toursMax} tours au plus${office}), date ${values.date}`);
console.log(`Questions couvertes : ${couvertes.length}`);
console.log(`  sans aucune recherche : ${compte(couvertes, (t) => nbRecherches(t) === 0)}`);
// Les recherches imposées par le code (d'office, de secours) ont un identifiant qui commence par « recherche- »
const demandees = (t: TraceAgent) => t.appels.filter((a) => NOMS_RECHERCHE.has(a.nom) && !a.id.startsWith("recherche-")).length;
console.log(`  au moins une recherche demandée par le LLM : ${compte(couvertes, (t) => demandees(t) > 0)}`);
console.log(`  plusieurs recherches : ${compte(couvertes, (t) => t.appels.filter((a) => a.nom.startsWith("chercher_")).length > 1)}`); // sans les lectures
console.log(`  un passage qui répond parmi les passages vus : ${compte(couvertes, (t) => t.succes === true)} sur ${couvertes.length} (pipeline du chapitre 9 : 51 dans ses 8 premiers)`);
console.log(`  un document qui répond parmi les documents vus : ${compte(couvertes, (t) => t.succesDocument === true)} sur ${couvertes.length}`);
console.log(`  réponse sans aucune source citée : ${compte(couvertes, (t) => t.cites.length === 0)}`);
console.log(`  dernier tour atteint : ${compte(couvertes, (t) => t.dernierTour)}`);
console.log(`Questions hors corpus et interdites : ${autres.length}, dont ${compte(autres, (t) => nbRecherches(t) > 0)} avec au moins une recherche`);
console.log(`Sources inventées (jamais rendues par un outil) : ${traces.reduce((s, t) => s + t.inventees.length, 0)}`);
console.log(`Par question : ${moyenne(traces.map((t) => t.tours))} tours, ${moyenne(traces.map((t) => t.tokens))} tokens, ${moyenne(traces.map((t) => t.secondes))} s en moyenne`);
await mkdir(dirname(values.traces), { recursive: true });
const fichier: FichierAgent = { date: values.date, prompt: `v${systeme.version} ${systeme.empreinte}`, toursMax, llm: `${config.LLM_PROVIDER} ${config.LLM_MODEL}`, traces };
await writeFile(values.traces, JSON.stringify(fichier, null, 2) + "\n");
console.log(`Traces : ${values.traces}`);
