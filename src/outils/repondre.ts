// Poser une question à Rhéa : la recherche, le prompt augmenté, puis la réponse du LLM choisi dans .env
// Lancement : npm run repondre -- "votre question" [--k 8] [--budget 1500] [--date 2026-01-15]
import { parseArgs } from "node:util";
import { config } from "../config.ts";
import { pool } from "../db.ts";
import { ligneDeSource, numerosCites } from "../generation/citations.ts";
import { creerGenerateur } from "../generation/generateur.ts";
import { assembler, BUDGET_PASSAGES, estimerTokens, PASSAGES_DEMANDES } from "../generation/prompt.ts";
import { lirePromptSysteme } from "../generation/systeme.ts";
import { aujourdhui, trouverPassages } from "../recherche/passages.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    k: { type: "string", default: String(PASSAGES_DEMANDES) },
    budget: { type: "string", default: String(BUDGET_PASSAGES) },
    date: { type: "string", default: aujourdhui() },
  },
});
const question = (positionals[0] ?? "Combien de jours de télétravail ai-je par semaine ?").trim();
const k = Number(values.k);
const budget = Number(values.budget);
if (!question || !Number.isInteger(k) || k < 1 || !Number.isInteger(budget) || budget < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(values.date)) {
  console.error("Attendu : une question, --k et --budget entiers positifs, --date au format AAAA-MM-JJ");
  process.exit(1);
}

const generer = creerGenerateur();
const systeme = await lirePromptSysteme();
const resultats = await trouverPassages(pool, question, k, values.date);
await pool.end();
const prompt = assembler(question, resultats, { systeme: systeme.texte, budget, mesure: estimerTokens, date: values.date });

const apercu = (texte: string) => {
  const ligne = texte.replace(/\s+/g, " ");
  return ligne.length > 90 ? `${ligne.slice(0, 90)}…` : ligne;
};

const debut = performance.now();
const { texte, usage, citations = [] } = await generer(prompt);
const duree = ((performance.now() - debut) / 1000).toFixed(1);
console.log(`« ${question} »`);
console.log(`Rhéa (${config.LLM_PROVIDER}, prompt v${systeme.version} ${systeme.empreinte}, ${prompt.passages.length} passages) en ${duree} s :\n`);
console.log(texte.trim());
const cites = numerosCites(texte, prompt.passages);
console.log(`\nSources citées :${cites.length === 0 ? " aucune" : ""}`);
for (const n of cites) {
  console.log(`  ${ligneDeSource(n, prompt.passages[n - 1])}`);
  // Avec Claude, chaque citation donne aussi le texte qu'elle cite, tiré mot pour mot du passage
  for (const c of citations.filter((c) => c.numero === n)) console.log(`      « ${apercu(c.texteCite)} »`);
}
console.log(`\nTokens : ${usage.entree} en entrée, dont ${usage.enCache} relus dans le cache ; ${usage.sortie} en sortie`);
