// Recherche sémantique en mémoire dans la FAQ RH.
// Lancement : npm run chercher -- "votre question" [--k 5] [--min 0.8] [--mesure]
import { parseArgs } from "node:util";
import { config } from "../config.ts";
import { chargerFaq } from "../corpus/faq.ts";
import { vectoriser } from "../embeddings/fournisseurs.ts";
import { indexer, topK } from "../recherche/memoire.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    k: { type: "string", default: "3" }, // nombre de passages renvoyés
    min: { type: "string", default: "-1" }, // score minimal (par défaut, aucun)
    mesure: { type: "boolean", default: false }, // mesurer le temps sur de grands index
  },
});
const question = positionals[0] ?? "Je pars en vacances trois semaines cet été, je dois prévenir quand ?";
const [k, scoreMin] = [Number(values.k), Number(values.min)];
const duree = (debut: number) => `${(performance.now() - debut).toFixed(1)} ms`;

// 1. Indexer la FAQ : un passage par question-réponse, avec un cache de vecteurs propre au modèle
const passages = (await chargerFaq()).map((e) => ({ id: e.id, texte: `${e.question}\n${e.reponse}` }));
const modele = [config.EMBEDDING_PROVIDER, config.EMBEDDING_MODEL, config.EMBEDDING_DIMENSIONS].filter(Boolean).join("-");
const fichierCache = `.cache/embeddings/${modele.replace(/[^\w.-]+/g, "_")}.json`;
let debut = performance.now();
const index = await indexer(passages, vectoriser, fichierCache);
console.log(`${index.length} passages indexés en ${duree(debut)}`);

// 2. Chercher : vectoriser la question, puis la comparer à tous les passages
debut = performance.now();
const [vQuestion] = await vectoriser([question], "requete");
console.log(`Question vectorisée en ${duree(debut)}`);
debut = performance.now();
const resultats = topK(vQuestion, index, k, scoreMin);
console.log(`${index.length} comparaisons en ${duree(debut)}\n\n« ${question} »`);
for (const { id, texte, score } of resultats) console.log(`  ${score.toFixed(3)}  ${id.padEnd(10)} ${texte.split("\n")[0]}`);
if (resultats.length === 0) console.log(`  Aucun passage au-dessus de ${scoreMin}`);

// 3. Avec --mesure : le temps de la même recherche sur des index bien plus grands.
// L'index factice répète les vrais passages : le calcul est le même que sur un vrai corpus de cette taille
if (values.mesure) {
  console.log("\nRecherche exhaustive selon la taille de l'index :");
  for (const taille of [1_000, 10_000, 100_000, 1_000_000]) {
    const grand = Array.from({ length: taille }, (_, i) => index[i % index.length]);
    let meilleur = Infinity; // le meilleur de trois essais, pour lisser les aléas de la machine
    for (let essai = 0; essai < 3; essai++) {
      debut = performance.now();
      topK(vQuestion, grand, k);
      meilleur = Math.min(meilleur, performance.now() - debut);
    }
    console.log(`  ${taille.toLocaleString("fr-FR").padStart(9)} passages : ${meilleur.toFixed(1)} ms`);
  }
}
