// Découpage sémantique : on vectorise chaque phrase, puis on coupe là où le sens change le plus
// d'une phrase à la suivante, sans regarder les titres
import type { Embedder } from "../embeddings/fournisseurs.ts";
import { produitScalaire } from "../embeddings/similarite.ts";
import type { Mesure } from "./mesure.ts";
import { phrases } from "./parents.ts";
import { redecouper } from "./structure.ts";

type Options = { taille: number; mesure: Mesure; percentile?: number };

export async function decouperSemantique(texte: string, vectoriser: Embedder, { taille, mesure, percentile = 90 }: Options) {
  const liste = phrases(texte);
  // 1. Un vecteur par phrase : c'est là que le découpage sémantique coûte, chaque phrase passe par le modèle
  const vecteurs = await vectoriser(liste.map((phrase) => phrase.trim()), "document");
  // 2. La distance entre deux phrases qui se suivent : 1 moins leur similarité (les vecteurs sont normalisés)
  const distances = vecteurs.slice(1).map((vecteur, i) => 1 - produitScalaire(vecteurs[i], vecteur));
  // 3. Le seuil : on coupe aux plus grands écarts, au-dessus du 90e percentile (10 % des écarts)
  const triees = [...distances].sort((a, b) => a - b);
  const seuil = triees[Math.floor(((triees.length - 1) * percentile) / 100)] ?? Infinity;
  const groupes = [liste[0] ?? ""];
  distances.forEach((distance, i) => {
    if (distance > seuil) groupes.push(liste[i + 1]);
    else groupes[groupes.length - 1] += liste[i + 1];
  });
  // 4. Un groupe plus grand que la taille voulue est redécoupé, comme dans le découpage structurel
  const morceaux = groupes.flatMap((groupe) => redecouper(groupe.trim(), taille, mesure)).map((morceau) => morceau.trim());
  return { morceaux, phrases: liste.length };
}
