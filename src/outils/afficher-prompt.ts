// Afficher le prompt augmenté qu'on enverrait au LLM pour une question, sans l'envoyer
// Lancement : npm run prompt -- "votre question" [--k 8] [--budget 1500] [--date 2026-01-15]
import { parseArgs } from "node:util";
import { pool } from "../db.ts";
import { assembler, baliser, BUDGET_PASSAGES, estimerTokens, PASSAGES_DEMANDES } from "../generation/prompt.ts";
import { aujourdhui, trouverPassages } from "../recherche/passages.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    k: { type: "string", default: String(PASSAGES_DEMANDES) }, // passages demandés à la recherche
    budget: { type: "string", default: String(BUDGET_PASSAGES) }, // tokens réservés aux passages dans le prompt
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

const resultats = await trouverPassages(pool, question, k, values.date);
await pool.end();
const prompt = assembler(question, resultats, { budget, mesure: estimerTokens, date: values.date });

console.log(`« ${question} » : ${resultats.length} passages trouvés, ${prompt.passages.length} gardés dans un budget de ${budget} tokens`);
prompt.passages.forEach((p, i) => console.log(`  [${i + 1}]  ${p.score.toFixed(3)}  ${p.id.padEnd(18)} ${estimerTokens(baliser(p, i + 1))} tokens`));
for (const p of prompt.ecartes) console.log(`  écarté ${p.score.toFixed(3)}  ${p.id.padEnd(18)} ${estimerTokens(baliser(p, 0))} tokens, plus de place`);
const tokens = estimerTokens(prompt.systeme) + estimerTokens(prompt.utilisateur);
console.log(`Prompt complet : environ ${tokens} tokens (estimation prudente, 3 caractères par token)\n`);
console.log(`=== Instructions (rôle système) ===\n${prompt.systeme}\n`);
console.log(`=== Message (rôle utilisateur) ===\n${prompt.utilisateur}`);
