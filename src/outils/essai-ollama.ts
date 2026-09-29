// Essai d'Ollama : embeddings et génération sur votre machine, sans clé ni coût.
// Lancement : npm run essai:ollama (Ollama lancé, modèles téléchargés, fournisseurs ollama dans .env)
import { config } from "../config.ts";
import { conseilOllama, ollama } from "../ollama.ts";

if (config.EMBEDDING_PROVIDER !== "ollama" || config.LLM_PROVIDER !== "ollama") {
  console.error("Passez EMBEDDING_PROVIDER et LLM_PROVIDER à ollama, dans .env ou sur la ligne de commande.");
  process.exit(1);
}

const question = "Combien de jours de télétravail ai-je par semaine ?";
const passages = [
  "Depuis le 1er mars 2026, vous pouvez télétravailler jusqu'à trois jours par semaine, sur accord de votre manager.",
  "Vous avez droit à 25 jours ouvrés de congés payés par an, acquis du 1er juin au 31 mai.",
  "Le plafond d'un repas avec un client est de 45 € par personne à Paris et de 35 € ailleurs.",
];

// 1. Embeddings : un vecteur pour la question et un pour chaque passage, en un seul appel
let debut = performance.now();
const { data } = await ollama.embeddings
  .create({ model: config.EMBEDDING_MODEL, input: [question, ...passages] })
  .catch(conseilOllama);
const [vQuestion, ...vPassages] = data.map((d) => d.embedding);
console.log(`${data.length} vecteurs de ${vQuestion.length} dimensions en ${Math.round(performance.now() - debut)} ms`);

// Similarité cosinus : produit scalaire divisé par le produit des longueurs
const produit = (a: number[], b: number[]) => a.reduce((somme, x, i) => somme + x * b[i], 0);
const cosinus = (a: number[], b: number[]) => produit(a, b) / Math.sqrt(produit(a, a) * produit(b, b));
const classement = passages
  .map((texte, i) => ({ texte, similarite: cosinus(vQuestion, vPassages[i]) }))
  .sort((a, b) => b.similarite - a.similarite);
for (const { texte, similarite } of classement) console.log(`  ${similarite.toFixed(2)}  ${texte.slice(0, 60)}…`);

// 2. Génération : le modèle local répond à partir du passage le plus proche.
// Avec stream: true, le texte arrive morceau par morceau : on l'affiche au fil de l'eau.
debut = performance.now();
const flux = await ollama.chat.completions
  .create({
    model: config.LLM_MODEL,
    stream: true,
    messages: [
      { role: "system", content: "Tu es Rhéa, l'assistant RH de Kalyo. Réponds en une phrase, à partir du contexte." },
      { role: "user", content: `Contexte : ${classement[0].texte}\n\nQuestion : ${question}` },
    ],
  })
  .catch(conseilOllama);
console.log();
for await (const morceau of flux) process.stdout.write(morceau.choices[0]?.delta?.content ?? "");
console.log(`\n\nRéponse générée en ${((performance.now() - debut) / 1000).toFixed(1)} s`);
