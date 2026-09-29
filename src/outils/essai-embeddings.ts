// Essai du fournisseur d'embeddings choisi dans .env : un lot de textes, la dimension, requête et document.
// Lancement : npm run essai:embeddings
import { readFile } from "node:fs/promises";
import { config } from "../config.ts";
import { vectoriser, type Usage } from "../embeddings/fournisseurs.ts";
import { norme, produitScalaire } from "../embeddings/similarite.ts";

console.log(`Fournisseur ${config.EMBEDDING_PROVIDER}, modèle ${config.EMBEDDING_MODEL}`);

// 1. Toute la FAQ d'un coup : vectoriser découpe en lots de 32 textes
const faq = await readFile("corpus/faq/faq-rh.md", "utf8");
const entrees = faq.split("\n## ").slice(1).map((bloc) => bloc.trim());
const debut = performance.now();
const vecteurs = await vectoriser(entrees, "document");
console.log(`${vecteurs.length} entrées vectorisées en ${Math.round(performance.now() - debut)} ms`);
console.log(`${vecteurs[0].length} dimensions, norme ${norme(vecteurs[0]).toFixed(3)}`);
console.log(`Début du premier vecteur : ${vecteurs[0].slice(0, 5).map((x) => x.toFixed(3)).join("  ")} …`);

// 2. La même question, encodée comme une requête, puis comme un document
const question = process.argv[2] ?? "Je pars en vacances trois semaines cet été, je dois prévenir quand ?";
for (const usage of ["requete", "document"] satisfies Usage[]) {
  const [v] = await vectoriser([question], usage);
  const classement = entrees
    .map((texte, i) => ({ titre: texte.split("\n")[0], score: produitScalaire(v, vecteurs[i]) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  console.log(`\nQuestion encodée comme ${usage} :`);
  for (const { titre, score } of classement) console.log(`  ${score.toFixed(3)}  ${titre}`);
}
