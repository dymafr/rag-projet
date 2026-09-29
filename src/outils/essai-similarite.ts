// Essai des trois mesures sur de vrais embeddings : produit scalaire, cosinus et distance.
// Lancement : npm run similarite
import { pipeline } from "@huggingface/transformers";
import { config } from "../config.ts";
import { cosinus, distance, norme, normaliser, produitScalaire } from "../embeddings/similarite.ts";

if (config.EMBEDDING_PROVIDER !== "transformers") {
  console.error("Cet essai utilise le modèle local : passez EMBEDDING_PROVIDER à transformers.");
  process.exit(1);
}

const question = "Combien de jours de télétravail ai-je par semaine ?";
const passages = [
  "Depuis le 1er mars 2026, vous pouvez télétravailler jusqu'à trois jours par semaine, sur accord de votre manager.",
  "Chaque équipe fixe avec son manager au moins un jour de présence commun par semaine.",
  "Un salarié à temps plein acquiert 25 jours ouvrés de congés payés par an.",
  "Le plafond d'un repas avec un client est de 45 € par personne à Paris.",
];

// Vecteurs bruts : on demande au modèle de NE PAS normaliser, pour voir leur longueur
const extraire = await pipeline("feature-extraction", config.EMBEDDING_MODEL, { dtype: "q8" });
const tenseur = await extraire(["query: " + question, ...passages.map((p) => "passage: " + p)], {
  pooling: "mean",
  normalize: false,
});
const [q, ...vecteurs]: number[][] = tenseur.tolist();

function afficher(titre: string, requete: number[], candidats: number[][]) {
  console.log(`\n${titre} (norme de la question : ${norme(requete).toFixed(3)})`);
  console.log("  produit   cosinus   distance   norme   passage");
  candidats.forEach((v, i) => {
    const colonnes = [produitScalaire(requete, v), cosinus(requete, v), distance(requete, v), norme(v)];
    console.log("  " + colonnes.map((x) => x.toFixed(3).padStart(7)).join("   ") + "   " + passages[i].slice(0, 45) + "…");
  });
}

afficher("Vecteurs bruts", q, vecteurs);
afficher("Vecteurs normalisés", normaliser(q), vecteurs.map(normaliser));
