// Poser une question à Rhéa : la recherche, le prompt augmenté, puis la réponse du LLM choisi dans .env
// Lancement : npm run repondre -- "votre question" [--k 8] [--budget 1500] [--date 2026-01-15]
//             [--json] (une réponse structurée, validée par zod) [--seuil 0.49] (le seuil d'abstention)
import { parseArgs } from "node:util";
import { config } from "../config.ts";
import { pool } from "../db.ts";
import { nomDuModele } from "../embeddings/fournisseurs.ts";
import { appuyee, horsCorpus, MESSAGE_ABSTENTION, MODELE_DU_SEUIL, SEUIL } from "../generation/abstention.ts";
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
    seuil: { type: "string", default: String(SEUIL) },
  },
});
const question = (positionals[0] ?? "Combien de jours de télétravail ai-je par semaine ?").trim();
const k = Number(values.k);
const budget = Number(values.budget);
const seuil = Number(values.seuil);
const dateValide = /^\d{4}-\d{2}-\d{2}$/.test(values.date);
if (!question || !Number.isInteger(k) || k < 1 || !Number.isInteger(budget) || budget < 1 || !dateValide || !(seuil >= 0 && seuil < 1)) {
  console.error("Attendu : une question, --k et --budget entiers positifs, --date au format AAAA-MM-JJ, --seuil entre 0 et 1");
  process.exit(1);
}
if (nomDuModele() !== MODELE_DU_SEUIL) {
  console.warn(`Attention : le seuil d'abstention a été mesuré avec ${MODELE_DU_SEUIL}, pas avec ${nomDuModele()}. Relancez npm run seuils`);
}

const generer = creerGenerateur();
const systeme = await lirePromptSysteme();
const resultats = await trouverPassages(pool, question, k, values.date);
await pool.end();
const prompt = assembler(question, resultats, { systeme: systeme.texte, budget, mesure: estimerTokens, date: values.date });

// Avant le LLM : une question trop loin de tous les passages, ou sans aucun passage gardé, n'est pas envoyée
if (horsCorpus(resultats, seuil) || prompt.passages.length === 0) {
  const raison = horsCorpus(resultats, seuil)
    ? `le meilleur passage n'a qu'un score de ${(resultats[0]?.score ?? 0).toFixed(3)}, sous le seuil de ${seuil}`
    : "aucun passage ne tient dans le budget";
  console.log(`« ${question} »\nRhéa s'abstient sans appeler le LLM : ${raison}\n`);
  console.log(MESSAGE_ABSTENTION);
  process.exit(0);
}

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
// Après le LLM : une réponse qui ne s'appuie sur aucune source vérifiable est remplacée par le message d'abstention
if (!appuyee(cites, verifiees)) console.log(`\nRéponse écartée, faute de source vérifiable. Rhéa répond à la place :\n${MESSAGE_ABSTENTION}`);
console.log(`\nTokens : ${usage.entree} en entrée, dont ${usage.enCache} relus dans le cache ; ${usage.sortie} en sortie`);
