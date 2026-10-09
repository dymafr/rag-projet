// Choisir le seuil d'abstention : le score du meilleur passage, pour des questions que le corpus couvre
// et pour d'autres qu'il ne couvre pas. Le seuil doit écarter les secondes sans perdre les premières
// Lancement : npm run seuils
import { pool } from "../db.ts";
import { nomDuModele } from "../embeddings/fournisseurs.ts";
import { MODELE_DU_SEUIL, SEUIL } from "../generation/abstention.ts";
import { trouverPassages } from "../recherche/passages.ts";

const questionsCouvertes = [
  "Combien de jours de télétravail ai-je par semaine ?",
  "Quel est le plafond pour un repas avec un client à Paris ?",
  "Mon fils a de la fièvre, je dois rester avec lui. Je pose quoi ?",
  "Combien de jours de congé pour mon mariage ?",
  "Quand est versée la paie ?",
  "Comment me faire rembourser mon abonnement de transport ?",
  "Je peux télétravailler depuis le Portugal cet été ?",
  "Combien me paie une semaine d'astreinte ?",
  "Ma mutuelle couvre-t-elle mes enfants ?",
  "Quel formulaire pour une note de frais ?",
  "Combien de RTT ai-je par an ?",
  "À quelle heure dois-je arriver le premier jour ?",
  "How many days can I work from home?",
  "Puis-je prendre un congé sans solde ?",
];
const questionsHorsCorpus = [
  "Quelle est la météo à Lyon demain ?",
  "Quel est le salaire de mon collègue Julien ?",
  "Écris-moi une fonction Python qui trie une liste.",
  "Qui a gagné la Coupe du monde 2022 ?",
  "Quelle est la capitale de l'Australie ?",
  "Donne-moi une recette de crêpes.",
  "Les chiens sont-ils acceptés au bureau ?",
  "Kalyo va-t-elle être rachetée ?",
  "Comment configurer mon VPN sous Linux ?",
  "Ai-je droit à un congé sabbatique ?",
];

// Le score du meilleur passage pour chaque question, du plus haut au plus bas
async function meilleursScores(questions: string[]) {
  const scores = [];
  for (const question of questions) scores.push({ question, score: (await trouverPassages(pool, question, 1))[0]?.score ?? 0 });
  return scores.sort((a, b) => b.score - a.score);
}
const scoresCouverts = await meilleursScores(questionsCouvertes);
const scoresHors = await meilleursScores(questionsHorsCorpus);
await pool.end();

console.log(`Modèle d'embedding : ${nomDuModele()}\n`);
for (const [titre, scores] of [["Questions couvertes", scoresCouverts], ["Questions hors corpus", scoresHors]] as const) {
  console.log(`${titre} (score du meilleur passage) :`);
  for (const { question, score } of scores) console.log(`  ${score.toFixed(3)}  ${question}`);
}

// Un seuil juste sous la plus faible des questions couvertes, avec une marge de 0,01
const plusFaible = scoresCouverts.at(-1)!.score;
const propose = Math.floor(Math.round((plusFaible - 0.01) * 1e6) / 1e4) / 100; // arrondi d'abord : 0,57 - 0,01 vaut 0,5599… en binaire
const ecartees = scoresHors.filter((s) => s.score < propose);
console.log(`\nPlus faible question couverte : ${plusFaible.toFixed(3)} ; seuil proposé : ${propose.toFixed(2)} (seuil actuel : ${SEUIL}, mesuré avec ${MODELE_DU_SEUIL})`);
console.log(`Ce seuil écarte ${ecartees.length} questions hors corpus sur ${scoresHors.length} ; les autres passent au LLM, qui doit s'abstenir lui-même`);
