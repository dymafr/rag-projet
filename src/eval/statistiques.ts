// L'intervalle de confiance d'un taux : mesuré sur peu de cas, un taux peut être loin du vrai. L'intervalle à 95 %
// (méthode de Wilson, adaptée aux petits nombres) donne les valeurs plausibles : 28 réussites sur 29, soit 97 %,
// veulent dire « probablement entre 83 % et 99 % ». Des intervalles qui se chevauchent ne prouvent pas que deux
// versions se valent : mesurées sur les mêmes questions, elles se comparent question par question
export function wilson(reussites: number, n: number, z = 1.96): { bas: number; haut: number } {
  if (n === 0) return { bas: 0, haut: 1 };
  const p = reussites / n;
  const centre = (p + (z * z) / (2 * n)) / (1 + (z * z) / n);
  const demiLargeur = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
  return { bas: Math.max(0, centre - demiLargeur), haut: Math.min(1, centre + demiLargeur) };
}
