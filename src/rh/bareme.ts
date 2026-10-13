// Le barème kilométrique de Kalyo : celui de la politique notes de frais (POL-NF-01, article 9), qui reprend le barème
// fiscal à titre indicatif ; le barème publié chaque année par l'administration fait foi. Un calcul ne se confie pas au
// LLM : le code applique la tranche, toujours de la même façon
export type Tranche = { jusqua: number; taux: number; fixe: number }; // indemnité = d × taux + fixe, pour d ≤ jusqua

// d : la distance professionnelle parcourue dans l'année civile, en kilomètres
export const BAREME: Record<number, Tranche[]> = {
  3: [{ jusqua: 5000, taux: 0.529, fixe: 0 }, { jusqua: 20000, taux: 0.316, fixe: 1065 }, { jusqua: Infinity, taux: 0.37, fixe: 0 }],
  4: [{ jusqua: 5000, taux: 0.606, fixe: 0 }, { jusqua: 20000, taux: 0.34, fixe: 1330 }, { jusqua: Infinity, taux: 0.407, fixe: 0 }],
  5: [{ jusqua: 5000, taux: 0.636, fixe: 0 }, { jusqua: 20000, taux: 0.357, fixe: 1395 }, { jusqua: Infinity, taux: 0.427, fixe: 0 }],
  6: [{ jusqua: 5000, taux: 0.665, fixe: 0 }, { jusqua: 20000, taux: 0.374, fixe: 1457 }, { jusqua: Infinity, taux: 0.447, fixe: 0 }],
  7: [{ jusqua: 5000, taux: 0.697, fixe: 0 }, { jusqua: 20000, taux: 0.394, fixe: 1515 }, { jusqua: Infinity, taux: 0.47, fixe: 0 }],
};

// « 3 CV et moins », « 7 CV et plus »
const ligne = (cv: number) => BAREME[Math.min(7, Math.max(3, cv))];

// Ce que vaut, sur l'année, une distance d parcourue avec un véhicule de cette puissance
export function annuel(d: number, cv: number): number {
  const tranche = ligne(cv).find((t) => d <= t.jusqua)!;
  return d * tranche.taux + tranche.fixe;
}

// Un trajet de km kilomètres, après dejaParcourus kilomètres professionnels cette année : la différence entre l'année
// avec et sans ce trajet. Un trajet qui fait passer le cap des 5 000 km change de tranche en cours de route
export function indemnite(km: number, cv: number, dejaParcourus = 0): number {
  const euros = annuel(dejaParcourus + km, cv) - annuel(dejaParcourus, cv);
  return Math.round(Number((euros * 100).toPrecision(12))) / 100; // sans l'erreur du binaire : 1,005 € → 1,01 €
}

// La formule appliquée, pour que le salarié puisse la vérifier, avec les nombres écrits à la française
const fr = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 3 });
export function detail(km: number, cv: number, dejaParcourus = 0): string {
  const avant = ligne(cv).find((t) => dejaParcourus <= t.jusqua)!;
  const apres = ligne(cv).find((t) => dejaParcourus + km <= t.jusqua)!;
  if (dejaParcourus === 0 && avant === apres) return `${fr(km)} × ${fr(avant.taux)}`;
  return `barème annuel à ${fr(dejaParcourus + km)} km, moins le barème annuel à ${fr(dejaParcourus)} km`;
}
