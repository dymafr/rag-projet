// Mesurer l'agent sur les questions « au-delà du texte » du chapitre 12 (eval/jeu-c12.json) : pour chaque question, les
// outils appelés, la réponse et son verdict (réussie si elle contient chaque mot attendu, et aucun mot interdit). Le
// bilan se lit par famille : les questions locales sont des témoins, les relationnelles, statistiques et globales sont
// celles que le texte seul ne sait pas traiter.
// Lancement : npm run eval:c12 -- [--date 2026-10-17] [--traces eval/traces/c12.json]
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { agir, type Agent } from "../agent/boucle.ts";
import { chercherDocuments } from "../agent/chercher.ts";
import { creerLlmAgent } from "../agent/llm-agent.ts";
import { calculerIndemniteKm, consulterProfil, consulterSolde, ouvrirTicket } from "../agent/outils-rh.ts";
import { consulterOrganigramme } from "../agent/organigramme.ts";
import { pool } from "../db.ts";
import { FAMILLES, lireJeuAuDela, verdict, type Verdict } from "../eval/au-dela.ts";
import { PASSAGES_DEMANDES } from "../generation/prompt.ts";
import { lirePromptSysteme } from "../generation/systeme.ts";
import { aujourdhui, trouverPassages } from "../recherche/passages.ts";

const { values } = parseArgs({
  options: {
    date: { type: "string", default: aujourdhui() },
    traces: { type: "string", default: "eval/traces/c12.json" },
  },
});
if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date)) throw new Error("Attendu : --date au format AAAA-MM-JJ");

const systeme = await lirePromptSysteme("prompts/rhea-agent.md");
// Les outils de npm run agent. Sans fonction confirmer, aucune action (un ticket) ne s'exécute : une mesure ne crée rien
const agent: Agent = {
  llm: creerLlmAgent(),
  outils: [
    chercherDocuments((requete, date) => trouverPassages(pool, requete, PASSAGES_DEMANDES, date)),
    consulterSolde(pool),
    consulterProfil(pool),
    consulterOrganigramme(pool), // leçon 2
    calculerIndemniteKm(),
    ouvrirTicket(pool),
  ],
  systeme: systeme.texte,
  recherche: "secours",
};

type Trace = { id: string; famille: string; question: string; matricule: string | null; outils: string[]; reponse: string; verdict: Verdict; secondes: number };
const traces: Trace[] = [];
const jeu = await lireJeuAuDela();
try {
  for (const q of jeu) {
    const debut = performance.now();
    const outils: string[] = [];
    let reponse = "";
    // Leçon 2 : avec un salarié connecté, sa fiche de l'organigramme d'office, comme dans npm run agent
    const office = q.matricule ? [{ id: "organigramme-d-office", nom: "consulter_organigramme", arguments: { personne: null } }] : [];
    for await (const etape of agir(q.question, { ...agent, appelsDOffice: office }, { date: values.date, matricule: q.matricule })) {
      if (etape.type === "appel") outils.push(etape.appel.nom);
      if (etape.type === "reponse") reponse = etape.texte.trim();
    }
    const trace: Trace = {
      id: q.id,
      famille: q.famille,
      question: q.question,
      matricule: q.matricule ?? null,
      outils,
      reponse,
      verdict: verdict(q, reponse),
      secondes: Math.round((performance.now() - debut) / 100) / 10,
    };
    traces.push(trace);
    console.log(`${q.id.padEnd(3)} ${q.famille.padEnd(13)} ${trace.verdict.padEnd(9)} ${outils.join(", ") || "aucun outil"}`);
    console.log(`    « ${q.question} »${q.matricule ? ` (${q.matricule})` : ""}`);
    console.log(`    → ${reponse.replace(/\s+/g, " ").slice(0, 220)}${reponse.length > 220 ? "…" : ""}`);
  }
} finally {
  await pool.end();
}

console.log(`\nAgent (prompt v${systeme.version} ${systeme.empreinte}), date ${values.date}`);
for (const famille of FAMILLES) {
  const liste = traces.filter((t) => t.famille === famille);
  if (liste.length === 0) continue;
  const notees = liste.filter((t) => t.verdict !== "non notée");
  const reussies = notees.filter((t) => t.verdict === "réussie").length;
  console.log(`  ${famille.padEnd(13)} ${notees.length ? `${reussies} réussie(s) sur ${notees.length}` : `${liste.length} question(s), non notée(s)`}`);
}
await mkdir(dirname(values.traces), { recursive: true });
await writeFile(values.traces, JSON.stringify(traces, null, 2) + "\n");
console.log(`Traces : ${values.traces}`);
