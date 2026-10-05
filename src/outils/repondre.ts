// Poser une question à Rhéa : la recherche, le prompt augmenté, puis la réponse du LLM choisi dans .env
// Lancement : npm run repondre -- "votre question" [--k 8] [--budget 1500] [--date 2026-01-15]
//             [--json] (une réponse structurée, validée par zod)
import { parseArgs } from "node:util";
import { config } from "../config.ts";
import { pool } from "../db.ts";
import { ligneDeSource, numerosDesSources, verifierCitations } from "../generation/citations.ts";
import { creerGenerateur, type Generation } from "../generation/generateur.ts";
import { assembler, BUDGET_PASSAGES, estimerTokens, PASSAGES_DEMANDES } from "../generation/prompt.ts";
import { repondreEnJson } from "../generation/structure.ts";
import { lirePromptSysteme } from "../generation/systeme.ts";
import { aujourdhui, trouverPassages } from "../recherche/passages.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    k: { type: "string", default: String(PASSAGES_DEMANDES) },
    budget: { type: "string", default: String(BUDGET_PASSAGES) },
    date: { type: "string", default: aujourdhui() },
    json: { type: "boolean", default: false },
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
console.log(`« ${question} »`);
let generation: Generation;
if (values.json) {
  // En JSON : la réponse, ses sources et la confiance arrivent dans un objet validé par zod
  const { reponse, essais, usage } = await repondreEnJson((consigne) => generer(prompt, { consigne }), prompt.passages.length);
  console.log(`JSON valide ${essais === 1 ? "du premier coup" : "au second essai"} :\n${JSON.stringify(reponse, null, 2)}\n`);
  generation = { texte: reponse.reponse, usage, citations: reponse.sources.map((s) => ({ numero: s.passage, texteCite: s.citation })) };
} else {
  generation = await generer(prompt);
}
const { texte, usage, citations = [] } = generation;
const duree = ((performance.now() - debut) / 1000).toFixed(1);
console.log(`Rhéa (${config.LLM_PROVIDER}, prompt v${systeme.version} ${systeme.empreinte}, ${prompt.passages.length} passages) en ${duree} s :\n`);
console.log(texte.trim());
const cites = numerosDesSources(texte, citations, prompt.passages);
// Avec Claude, ou en JSON, chaque citation donne l'extrait qu'elle dit tirer du passage : on vérifie qu'il y figure
const verifiees = verifierCitations(citations, prompt.passages);
console.log(`\nSources citées :${cites.length === 0 ? " aucune" : ""}`);
for (const n of cites) {
  console.log(`  ${ligneDeSource(n, prompt.passages[n - 1])}`);
  const siennes = verifiees.filter((c) => c.numero === n);
  if (siennes.length === 0) console.log("      (aucun extrait cité : seul le numéro est connu)");
  for (const c of siennes) console.log(`      ${c.trouvee ? "vérifiée   " : "INTROUVABLE"} « ${apercu(c.texteCite)} »`);
}
if (verifiees.length > 0) {
  const trouvees = verifiees.filter((c) => c.trouvee).length;
  console.log(`Citations retrouvées dans leur passage : ${trouvees} sur ${verifiees.length}`);
}
console.log(`\nTokens : ${usage.entree} en entrée, dont ${usage.enCache} relus dans le cache ; ${usage.sortie} en sortie`);
