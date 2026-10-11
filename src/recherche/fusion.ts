// Fusionner plusieurs classements en un seul, par leurs rangs (Reciprocal Rank Fusion, RRF) : dans chaque liste, un
// passage reçoit 1 / (K_RRF + son rang) ; on additionne ces parts. Seuls les rangs comptent : les scores des recherches,
// qui ne se comparent pas entre eux (une similarité cosinus, un score BM25), sont ignorés
export const K_RRF = 60; // la constante de l'article d'origine (2009) : plus elle est grande, plus les premiers rangs se valent

// listes : des identifiants, du meilleur au moins bon. poids : l'importance de chaque liste (1 par défaut)
export function fusionner(listes: string[][], poids: number[] = listes.map(() => 1), k = K_RRF): string[] {
  const scores = new Map<string, number>();
  listes.forEach((liste, l) =>
    liste.forEach((id, rang) => scores.set(id, (scores.get(id) ?? 0) + poids[l] / (k + rang + 1))),
  );
  // À score égal, l'ordre d'arrivée décide (celui de la première liste qui cite le passage) : le résultat est stable
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
