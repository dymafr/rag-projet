// Poser une question à Rhéa en agent : le LLM décide s'il cherche, et quoi. Chaque étape s'affiche : les appels
// d'outil demandés, leurs résultats, puis la réponse et ses sources
// Lancement : npm run agent -- "votre question" [--matricule K0101] [--date 2026-10-13] [--tours 5] [--recherche secours]
//             [--oui] (accepter d'office les actions, pour une démo enregistrée)
//             [--sources fichiers] (leçon 7 : chercher sans vecteurs, dans donnees/textes, avec les outils d'un agent de code)
// --matricule : le salarié connecté. Il n'y a pas de vraie connexion dans ce projet : l'option la simule.
// Chaque appel d'outil s'ajoute au journal du jour, dans journal/ (leçon 5)
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { agir, TOURS_MAX, type Recherche } from "../agent/boucle.ts";
import { journalJsonl } from "../agent/journal.ts";
import type { AppelOutil } from "../agent/llm-agent.ts";
import { chercherDocuments } from "../agent/chercher.ts";
import { DOSSIER_TEXTES, outilsFichiers } from "../agent/fichiers.ts";
import { creerLlmAgent } from "../agent/llm-agent.ts";
import { calculerIndemniteKm, consulterProfil, consulterSolde, ouvrirTicket } from "../agent/outils-rh.ts";
import { fichiersCites, sourcesCitees } from "../agent/sources.ts";
import { config } from "../config.ts";
import { pool } from "../db.ts";
import { PASSAGES_DEMANDES } from "../generation/prompt.ts";
import { lirePromptSysteme } from "../generation/systeme.ts";
import { creerLlm } from "../llm.ts";
import { condenser, type Echange } from "../recherche/conversation.ts";
import { aujourdhui, trouverPassages } from "../recherche/passages.ts";
import type { Resultat } from "../recherche/vectorielle.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  allowNegative: true,
  options: {
    date: { type: "string", default: aujourdhui() },
    matricule: { type: "string" },
    recherche: { type: "string", default: "secours" }, // libre, office ou secours : qui décide de la première recherche
    tours: { type: "string", default: String(TOURS_MAX) },
    oui: { type: "boolean", default: false },
    sources: { type: "string", default: "documents" }, // documents (la recherche de Rhéa) ou fichiers (leçon 7)
  },
});
const question = (positionals[0] ?? "Combien de jours de télétravail ai-je par semaine ?").trim();
const toursMax = Number(values.tours);
if (!["libre", "office", "secours"].includes(values.recherche)) throw new Error("--recherche attend libre, office ou secours");
if (!["documents", "fichiers"].includes(values.sources)) throw new Error("--sources attend documents ou fichiers");
const surFichiers = values.sources === "fichiers";
const matriculeValide = values.matricule === undefined || /^K\d{4}$/.test(values.matricule);
if (!question || !/^\d{4}-\d{2}-\d{2}$/.test(values.date) || !Number.isInteger(toursMax) || toursMax < 1 || !matriculeValide) {
  console.error("Attendu : une question, --date au format AAAA-MM-JJ, --tours entier positif, --matricule au format K0101");
  process.exit(1);
}

const systeme = await lirePromptSysteme(surFichiers ? "prompts/rhea-fichiers.md" : "prompts/rhea-agent.md");
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

// La confirmation, dans le terminal : le salarié lit l'action et répond. Sans terminal (une commande lancée par un script),
// personne ne peut répondre : l'action est refusée, sauf avec --oui
async function confirmer(_appel: AppelOutil, action: string): Promise<boolean> {
  if (values.oui) {
    console.log(`         ? Rhéa veut ${action}. Accepté d'office (--oui)`);
    return true;
  }
  if (!process.stdin.isTTY) {
    console.log(`         ? Rhéa veut ${action}. Refusé : personne pour confirmer`);
    return false;
  }
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  const reponse = await terminal.question(`         ? Rhéa veut ${action}. Confirmez-vous ? (o/N) `);
  terminal.close();
  return /^o(ui)?$/i.test(reponse.trim());
}
const agent = {
  llm: creerLlmAgent(),
  outils,
  systeme: systeme.texte,
  toursMax,
  // La recherche imposée passe par chercher_documents : sur fichiers, le LLM décide seul
  recherche: (surFichiers ? "libre" : values.recherche) as Recherche,
  condenser: (question: string, historique: Echange[]) => condenser(question, historique, llmSimple),
  confirmer,
  journaliser: journalJsonl(),
};

const secondes = (ms: number) => (ms / 1000).toFixed(1);
// Ce que l'outil a rendu, en une ligne : les passages et le meilleur d'entre eux, ou le début du texte
function resume(resultat: { texte: string; passages?: Resultat[] }, erreur: boolean): string {
  if (erreur) return `ERREUR : ${resultat.texte.split("\n").join(" ")}`;
  const passages = resultat.passages ?? [];
  if (passages.length > 0) return `${passages.length} passages, le premier : ${passages[0].id} (score ${passages[0].score.toFixed(3)})`;
  const ligne = resultat.texte.replace(/\s+/g, " ");
  return ligne.length > 100 ? `${ligne.slice(0, 100)}…` : ligne;
}

const qui = values.matricule ? `salarié ${values.matricule}` : "aucun salarié connecté";
console.log(`« ${question} »  (${config.LLM_PROVIDER}, prompt v${systeme.version} ${systeme.empreinte}, date ${values.date}, ${qui})\n`);
const vus: Resultat[] = []; // tous les passages rendus par les outils : seules leurs sources peuvent être citées
const fichiersVus = new Set<string>(); // sur fichiers : ceux qui ont été lus, ou où une ligne a été trouvée
const debut = performance.now();
try {
  for await (const etape of agir(question, agent, { date: values.date, matricule: values.matricule })) {
    if (etape.type === "appel") {
      // tour 0 : la recherche d'office ; « Secours » : celle du code quand le LLM n'a rien appelé
      const quand = etape.tour === 0 ? "D'office" : etape.appel.id === "recherche-de-secours" ? `Tour ${etape.tour}, secours` : `Tour ${etape.tour}`;
      console.log(`${quand} : ${etape.appel.nom}(${JSON.stringify(etape.appel.arguments)})`);
    } else if (etape.type === "resultat") {
      vus.push(...(etape.resultat.passages ?? []));
      for (const m of etape.resultat.texte.matchAll(/^([A-Z0-9-]+)\.md(?:, lignes|:\d+:)/gm)) fichiersVus.add(m[1]);
      const statut = etape.statut === "refusé" || etape.statut === "limite" ? `${etape.statut.toUpperCase()} : ` : "";
      console.log(`         → ${statut}${resume(etape.resultat, etape.erreur && !statut)} en ${secondes(etape.duree)} s`);
      if (etape.detail) console.log(`           (cause, gardée hors du prompt : ${etape.detail})`);
    } else if (etape.type === "limite") {
      const raison = etape.raison === "tokens" ? "budget de tokens atteint" : `--tours ${toursMax}`;
      console.log(`Tour ${etape.tour} : dernier tour, sans outil (${raison})`);
    } else {
      console.log(`Tour ${etape.tour} : réponse, en ${secondes(performance.now() - debut)} s au total\n\n${etape.texte.trim()}`);
      if (surFichiers) {
        const { cites, inventes } = fichiersCites(etape.texte, fichiersVus);
        console.log(`\nFichiers cités :${cites.length + inventes.length === 0 ? " aucun" : ""}`);
        for (const id of cites) console.log(`  [${id}.md]`);
        for (const id of inventes) console.log(`  [${id}.md]  INTROUVABLE : ni lu, ni trouvé par chercher_texte`);
      } else {
        const { citees, inventees } = sourcesCitees(etape.texte, vus);
        console.log(`\nSources citées :${citees.length + inventees.length === 0 ? " aucune" : ""}`);
        for (const p of citees) console.log(`  [${p.id}]  ${p.titres.join(" > ")}`);
        for (const id of inventees) console.log(`  [${id}]  INTROUVABLE : aucun outil n'a rendu ce passage`);
      }
      console.log(`\nTokens : ${etape.usage.entree} en entrée, dont ${etape.usage.enCache} relus dans le cache ; ${etape.usage.sortie} en sortie`);
    }
  }
} finally {
  await pool.end();
}
