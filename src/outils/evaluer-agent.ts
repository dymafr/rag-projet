// Mesurer l'agent sur le jeu d'évaluation du chapitre 8 : pour chaque question, ce que l'agent a fait (recherches,
// autres outils, tours, tokens) et, pour une question couverte, si un passage qui répond (pertinence 2) figure parmi
// ceux que ses recherches lui ont rendus. Le pipeline figé du chapitre 9 en trouvait un dans ses 8 premiers pour 51
// questions couvertes sur 52 : l'agent fait-il mieux, ou décide-t-il parfois de ne pas chercher ?
// Lancement : npm run eval:agent -- [--date 2026-10-13] [--tours 5] [--traces eval/traces/agent.json]
//             [--prompt prompts/rhea-agent.md] (comparer deux versions du prompt, sur tout le jeu)
//             [--recherche secours] (libre : le LLM décide seul ; office : le code cherche d'abord ; secours : le code
//             cherche si le LLM n'a appelé aucun outil)
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { agir, TOURS_MAX, type Recherche } from "../agent/boucle.ts";
import { chercherDocuments } from "../agent/chercher.ts";
import { creerLlmAgent } from "../agent/llm-agent.ts";
import { calculerIndemniteKm, consulterProfil, consulterSolde, ouvrirTicket } from "../agent/outils-rh.ts";
import { sourcesCitees } from "../agent/sources.ts";
import { pool } from "../db.ts";
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
    prompt: { type: "string", default: "prompts/rhea-agent.md" },
    recherche: { type: "string", default: "secours" }, // libre, office ou secours : qui décide de la première recherche
  },
});
const toursMax = Number(values.tours);
if (!["libre", "office", "secours"].includes(values.recherche)) throw new Error("--recherche attend libre, office ou secours");
if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date) || !Number.isInteger(toursMax) || toursMax < 1) {
  throw new Error("Attendu : --date au format AAAA-MM-JJ, --tours entier positif");
}

const systeme = await lirePromptSysteme(values.prompt);
// Les outils de Rhéa, sans salarié connecté : les questions du jeu ne parlent de la situation de personne. Un ticket
// demandé par erreur ne s'ouvrirait pas : sans salarié, l'outil ne fait rien
const outils = [
  chercherDocuments((requete, date) => trouverPassages(pool, requete, PASSAGES_DEMANDES, date)),
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
  recherche: values.recherche as Recherche,
  condenser: (question: string, historique: Echange[]) => condenser(question, historique, llmSimple),
};

type Trace = {
  id: string;
  categorie: string;
  question: string;
  appels: { id: string; nom: string; arguments: unknown }[];
  tours: number;
  dernierTour: boolean; // la boucle a dû retirer les outils
  succes: boolean | null; // couverte : un passage de pertinence 2 parmi les passages vus ; sinon null
  cites: string[];
  inventees: string[];
  tokens: number;
  secondes: number;
  reponse: string;
};
const traces: Trace[] = [];
const jeu = await lireJeu();
try {
  for (const q of jeu) {
    const debut = performance.now();
    const vus: Resultat[] = [];
    const trace: Trace = { id: q.id, categorie: q.categorie, question: q.question, appels: [], tours: 0, dernierTour: false, succes: null, cites: [], inventees: [], tokens: 0, secondes: 0, reponse: "" };
    const historique = q.categorie === "couverte" ? (q.historique ?? []) : [];
    for await (const etape of agir(q.question, agent, { date: q.date ?? values.date }, historique)) {
      if (etape.type === "appel") trace.appels.push({ id: etape.appel.id, nom: etape.appel.nom, arguments: etape.appel.arguments });
      else if (etape.type === "resultat") vus.push(...(etape.resultat.passages ?? []));
      else if (etape.type === "limite") trace.dernierTour = true;
      else {
        const { citees, inventees } = sourcesCitees(etape.texte, vus);
        Object.assign(trace, { tours: etape.tour, reponse: etape.texte.trim(), cites: citees.map((p) => p.id), inventees, tokens: etape.usage.entree + etape.usage.sortie });
      }
    }
    if (q.categorie === "couverte") trace.succes = vus.some((p) => q.passages[p.id] === 2);
    trace.secondes = Math.round((performance.now() - debut) / 100) / 10;
    traces.push(trace);
    const recherches = trace.appels.filter((a) => a.nom === "chercher_documents").length;
    const autres = trace.appels.filter((a) => a.nom !== "chercher_documents").map((a) => a.nom);
    const verdict = trace.succes === null ? "" : trace.succes ? " trouvé" : " MANQUÉ";
    console.log(`${q.id} ${q.categorie.padEnd(11)} ${recherches} recherche(s)${autres.length ? ` + ${autres.join(", ")}` : ""}, ${trace.tours} tour(s)${verdict}`);
  }
} finally {
  await pool.end();
}

// Le bilan
const couvertes = traces.filter((t) => t.categorie === "couverte");
const autres = traces.filter((t) => t.categorie !== "couverte");
const recherches = (t: Trace) => t.appels.filter((a) => a.nom === "chercher_documents").length;
const compte = (liste: Trace[], f: (t: Trace) => boolean) => liste.filter(f).length;
const moyenne = (liste: number[]) => (liste.reduce((s, n) => s + n, 0) / Math.max(1, liste.length)).toFixed(1);
const office = `, recherche ${agent.recherche}`;
console.log(`\nAgent (prompt v${systeme.version} ${systeme.empreinte}, ${toursMax} tours au plus${office}), date ${values.date}`);
console.log(`Questions couvertes : ${couvertes.length}`);
console.log(`  sans aucune recherche : ${compte(couvertes, (t) => recherches(t) === 0)}`);
// Les recherches imposées par le code (d'office, de secours) ont un identifiant qui commence par « recherche- »
const demandees = (t: Trace) => t.appels.filter((a) => a.nom === "chercher_documents" && !a.id.startsWith("recherche-")).length;
console.log(`  au moins une recherche demandée par le LLM : ${compte(couvertes, (t) => demandees(t) > 0)}`);
console.log(`  plusieurs recherches : ${compte(couvertes, (t) => recherches(t) > 1)}`);
console.log(`  un passage qui répond parmi les passages vus : ${compte(couvertes, (t) => t.succes === true)} sur ${couvertes.length} (pipeline du chapitre 9 : 51 dans ses 8 premiers)`);
console.log(`  réponse sans aucune source citée : ${compte(couvertes, (t) => t.cites.length === 0)}`);
console.log(`  dernier tour atteint : ${compte(couvertes, (t) => t.dernierTour)}`);
console.log(`Questions hors corpus et interdites : ${autres.length}, dont ${compte(autres, (t) => recherches(t) > 0)} avec au moins une recherche`);
console.log(`Sources inventées (jamais rendues par un outil) : ${traces.reduce((s, t) => s + t.inventees.length, 0)}`);
console.log(`Par question : ${moyenne(traces.map((t) => t.tours))} tours, ${moyenne(traces.map((t) => t.tokens))} tokens, ${moyenne(traces.map((t) => t.secondes))} s en moyenne`);
await mkdir(dirname(values.traces), { recursive: true });
await writeFile(values.traces, JSON.stringify({ date: values.date, prompt: `v${systeme.version} ${systeme.empreinte}`, toursMax, traces }, null, 2) + "\n");
console.log(`Traces : ${values.traces}`);
