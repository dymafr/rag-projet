// Un premier RAG : Rhéa répond à une question à partir de la FAQ RH de Kalyo.
// Lancement : node --env-file=.env premier-rag.ts "Votre question"
import { readFile } from "node:fs/promises";
import { pipeline } from "@huggingface/transformers";
import Anthropic from "@anthropic-ai/sdk";

const question = process.argv[2] ?? "Combien de jours de télétravail ai-je par semaine ?";

// 1. Charger la FAQ et la découper : un morceau par question-réponse
const faq = await readFile("corpus/faq/faq-rh.md", "utf8");
const morceaux = faq.split("\n## ").slice(1).map((bloc) => bloc.trim());

// 2. Calculer un embedding par morceau, avec un modèle local et multilingue
const extraire = await pipeline("feature-extraction", process.env.EMBEDDING_MODEL!, { dtype: "q8" });
async function vectoriser(textes: string[]): Promise<number[][]> {
  const tenseur = await extraire(textes, { pooling: "mean", normalize: true });
  return tenseur.tolist();
}
// Les modèles e5 attendent un préfixe qui distingue les passages des questions
const vecteurs = await vectoriser(morceaux.map((m) => "passage: " + m));

// 3. Chercher les trois morceaux les plus proches de la question
const [vecteurQuestion] = await vectoriser(["query: " + question]);
// Les vecteurs sont normalisés : leur produit scalaire est la similarité cosinus
const similarite = (a: number[], b: number[]) => a.reduce((somme, x, i) => somme + x * b[i], 0);
const meilleurs = morceaux
  .map((texte, i) => ({ texte, score: similarite(vecteurQuestion, vecteurs[i]) }))
  .sort((a, b) => b.score - a.score)
  .slice(0, 3);
meilleurs.forEach((m, i) => console.log(`[${i + 1}] ${m.score.toFixed(3)}  ${m.texte.split("\n")[0]}`));

// 4. Construire le prompt augmenté
const extraits = meilleurs.map((m, i) => `[${i + 1}] ${m.texte}`).join("\n\n");
const prompt = `Extraits de la FAQ RH :\n\n${extraits}\n\nQuestion : ${question}`;

// 5. Générer la réponse avec Claude
const client = new Anthropic(); // lit ANTHROPIC_API_KEY dans l'environnement
const reponse = await client.messages.create({
  model: process.env.LLM_MODEL!,
  max_tokens: 4096,
  system:
    "Tu es Rhéa, l'assistant RH de Kalyo. Réponds uniquement à partir des extraits fournis. " +
    "Cite les extraits utilisés avec leur numéro, par exemple [1]. " +
    "Si les extraits ne permettent pas de répondre, dis-le.",
  messages: [{ role: "user", content: prompt }],
});
for (const bloc of reponse.content) {
  if (bloc.type === "text") console.log("\n" + bloc.text);
}
