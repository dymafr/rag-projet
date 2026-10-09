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

// Comparer deux versions sur les mêmes questions (test exact de McNemar) : seules comptent les questions qui changent,
// gagnees (ratée avant, réussie après) et perdues (l'inverse). Si les deux versions se valaient, chaque changement
// irait d'un côté ou de l'autre à pile ou face. p est la probabilité d'un écart au moins aussi grand par le seul hasard :
// au-dessus de 0,05, on ne peut pas dire que la nouvelle version est meilleure (ni moins bonne)
export function mcNemar(gagnees: number, perdues: number): number {
  const n = gagnees + perdues;
  if (n === 0) return 1;
  let queue = 0; // la probabilité d'un écart au moins aussi déséquilibré d'un côté
  for (let i = 0; i <= Math.min(gagnees, perdues); i++) queue += combinaisons(n, i) / 2 ** n;
  return Math.min(1, 2 * queue);
}

// Le nombre de façons de choisir k éléments parmi n
function combinaisons(n: number, k: number): number {
  let resultat = 1;
  for (let i = 1; i <= k; i++) resultat = (resultat * (n - k + i)) / i;
  return resultat;
}
