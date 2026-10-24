// Le test de McNemar exact (chapitre 8) : deux exécutions sur les mêmes questions ; seules comptent celles qui changent
// de verdict. Sous l'hypothèse « aucune différence », chaque changement va dans un sens ou dans l'autre avec la même
// probabilité : la loi binomiale de paramètre 1/2 dit si l'écart observé peut venir du hasard. p bilatéral

// La probabilité d'au plus k succès sur n tirages à pile ou face
function queueBinomiale(n: number, k: number): number {
  let terme = 0.5 ** n; // P(0)
  let somme = terme;
  for (let i = 1; i <= k; i++) {
    terme = (terme * (n - i + 1)) / i;
    somme += terme;
  }
  return somme;
}

// gagnees : questions échouées par A et réussies par B ; perdues : l'inverse
export function mcnemarExact(gagnees: number, perdues: number): number {
  const n = gagnees + perdues;
  if (n === 0) return 1;
  return Math.min(1, 2 * queueBinomiale(n, Math.min(gagnees, perdues)));
}

export const SEUIL_P = 0.05;

// Combien de questions gagnées de plus, à pertes égales, il faudrait pour que l'écart soit démontré
export function gainsManquants(gagnees: number, perdues: number): number | null {
  if (gagnees <= perdues) return null;
  for (let plus = 0; plus <= 500; plus++) if (mcnemarExact(gagnees + plus, perdues) < SEUIL_P) return plus;
  return null;
}
