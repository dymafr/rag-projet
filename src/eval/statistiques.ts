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

// Chapitre 14, leçon 2 : combien de questions faut-il ? La probabilité d'obtenir au plus k échecs sur n questions, si le
// vrai taux d'échec de Rhéa est p (la loi binomiale : chaque question réussit ou échoue, indépendamment des autres)
export function auPlus(k: number, n: number, p: number): number {
  if (p <= 0) return 1;
  if (p >= 1) return k >= n ? 1 : 0;
  let terme = (1 - p) ** n; // aucun échec
  let somme = terme;
  for (let i = 0; i < Math.min(k, n); i++) {
    terme *= ((n - i) / (i + 1)) * (p / (1 - p)); // de i échecs à i + 1
    somme += terme;
  }
  return Math.min(1, somme);
}

// La borne haute du vrai taux d'échec, à 95 % (unilatérale), après k échecs sur n questions : la méthode exacte de
// Clopper-Pearson. C'est le plus grand taux qui rendait encore plausible (5 % de chances ou plus) un résultat aussi bon.
// 0 échec sur 62 : 4,7 % ; 1 sur 160 : 2,9 % ; 0 sur 160 : 1,9 % ; 0 sur 240 : 1,2 %
export function borneDesEchecs(k: number, n: number, confiance = 0.95): number {
  if (k >= n) return 1;
  let bas = 0;
  let haut = 1;
  for (let i = 0; i < 60; i++) {
    const milieu = (bas + haut) / 2;
    if (auPlus(k, n, milieu) > 1 - confiance) bas = milieu;
    else haut = milieu;
  }
  return haut;
}

// La règle de trois : sans aucun échec sur n questions, le vrai taux d'échec reste, à 95 %, sous 3 / n environ
export const regleDeTrois = (n: number) => 3 / n;

// Le nombre de façons de choisir k éléments parmi n
function combinaisons(n: number, k: number): number {
  let resultat = 1;
  for (let i = 1; i <= k; i++) resultat = (resultat * (n - k + i)) / i;
  return resultat;
}
