// Mesures de similarité entre deux vecteurs de même dimension

// Produit scalaire : somme des produits coordonnée par coordonnée
export function produitScalaire(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error(`dimensions différentes : ${a.length} et ${b.length}`);
  let somme = 0;
  for (let i = 0; i < a.length; i++) somme += a[i] * b[i];
  return somme;
}

// Norme : la longueur du vecteur
export const norme = (v: number[]) => Math.sqrt(produitScalaire(v, v));

// Similarité cosinus : le produit scalaire, divisé par les deux longueurs. Entre -1 et 1
export function cosinus(a: number[], b: number[]): number {
  const longueurs = norme(a) * norme(b);
  if (longueurs === 0) throw new Error("un vecteur nul n'a pas de direction");
  return produitScalaire(a, b) / longueurs;
}

// Distance euclidienne : la longueur du segment qui relie les deux pointes
export function distance(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error(`dimensions différentes : ${a.length} et ${b.length}`);
  return norme(a.map((x, i) => x - b[i]));
}

// Normaliser : garder la direction, ramener la longueur à 1
export function normaliser(v: number[]): number[] {
  const longueur = norme(v);
  if (longueur === 0) throw new Error("un vecteur nul n'a pas de direction");
  return v.map((x) => x / longueur);
}
