// Poser une question à Rhéa en agent : le LLM décide s'il cherche, et quoi. Chaque étape s'affiche : les appels
// d'outil demandés, leurs résultats, puis la réponse et ses sources
// Lancement : npm run agent -- "votre question" [--matricule K0101] [--date 2026-10-13] [--tours 5]
// --matricule : le salarié connecté. Il n'y a pas de vraie connexion dans ce projet : l'option la simule
import { parseArgs } from "node:util";
import { agir, TOURS_MAX } from "../agent/boucle.ts";
import { chercherDocuments } from "../agent/chercher.ts";
import { creerLlmAgent } from "../agent/llm-agent.ts";
import { calculerIndemniteKm, consulterSolde, ouvrirTicket } from "../agent/outils-rh.ts";
import { sourcesCitees } from "../agent/sources.ts";
import { config } from "../config.ts";
import { pool } from "../db.ts";
import { PASSAGES_DEMANDES } from "../generation/prompt.ts";
import { lirePromptSysteme } from "../generation/systeme.ts";
import { aujourdhui, trouverPassages } from "../recherche/passages.ts";
import type { Resultat } from "../recherche/vectorielle.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    date: { type: "string", default: aujourdhui() },
    matricule: { type: "string" },
    tours: { type: "string", default: String(TOURS_MAX) },
  },
});
const question = (positionals[0] ?? "Combien de jours de télétravail ai-je par semaine ?").trim();
const toursMax = Number(values.tours);
const matriculeValide = values.matricule === undefined || /^K\d{4}$/.test(values.matricule);
if (!question || !/^\d{4}-\d{2}-\d{2}$/.test(values.date) || !Number.isInteger(toursMax) || toursMax < 1 || !matriculeValide) {
  console.error("Attendu : une question, --date au format AAAA-MM-JJ, --tours entier positif, --matricule au format K0101");
  process.exit(1);
}

const systeme = await lirePromptSysteme("prompts/rhea-agent.md");
const outils = [
  chercherDocuments((requete, date) => trouverPassages(pool, requete, PASSAGES_DEMANDES, date)),
  consulterSolde(pool),
  calculerIndemniteKm(),
  ouvrirTicket(pool),
];
const agent = { llm: creerLlmAgent(), outils, systeme: systeme.texte, toursMax };

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
const debut = performance.now();
try {
  for await (const etape of agir(question, agent, { date: values.date, matricule: values.matricule })) {
    if (etape.type === "appel") {
      console.log(`Tour ${etape.tour} : ${etape.appel.nom}(${JSON.stringify(etape.appel.arguments)})`);
    } else if (etape.type === "resultat") {
      vus.push(...(etape.resultat.passages ?? []));
      console.log(`         → ${resume(etape.resultat, etape.erreur)} en ${secondes(etape.duree)} s`);
      if (etape.detail) console.log(`           (cause, gardée hors du prompt : ${etape.detail})`);
    } else if (etape.type === "limite") {
      console.log(`\nRhéa s'arrête après ${etape.tour} tours sans avoir répondu.`);
      console.log(`Tokens : ${etape.usage.entree} en entrée ; ${etape.usage.sortie} en sortie`);
    } else {
      console.log(`Tour ${etape.tour} : réponse, en ${secondes(performance.now() - debut)} s au total\n\n${etape.texte.trim()}`);
      const { citees, inventees } = sourcesCitees(etape.texte, vus);
      console.log(`\nSources citées :${citees.length + inventees.length === 0 ? " aucune" : ""}`);
      for (const p of citees) console.log(`  [${p.id}]  ${p.titres.join(" > ")}`);
      for (const id of inventees) console.log(`  [${id}]  INTROUVABLE : aucun outil n'a rendu ce passage`);
      console.log(`\nTokens : ${etape.usage.entree} en entrée, dont ${etape.usage.enCache} relus dans le cache ; ${etape.usage.sortie} en sortie`);
    }
  }
} finally {
  await pool.end();
}
