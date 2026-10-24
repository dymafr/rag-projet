// Les nombres, durées, coûts et dates au format français : virgule décimale, espace fine insécable entre les milliers
// (Intl), espace insécable avant une unité. Tout ce que l'interface affiche passe par ici

export const INSECABLE = String.fromCharCode(0x00a0);
export const FINE = String.fromCharCode(0x202f);

const entier = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const formats = new Map<string, Intl.NumberFormat>();
const avec = (min: number, max: number) => {
  const cle = `${min}-${max}`;
  let f = formats.get(cle);
  if (!f) {
    f = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: min, maximumFractionDigits: max });
    formats.set(cle, f);
  }
  return f;
};

export const nombre = (n: number) => entier.format(n);
export const decimal = (n: number, chiffres = 2) => avec(chiffres, chiffres).format(n);
export const score = (n: number) => decimal(n, 3);

// Un pourcentage : « 42 % » (espace fine insécable, comme le fait Intl en français)
export const pourcentage = (rapport: number, chiffres = 0) => `${avec(chiffres, chiffres).format(rapport * 100)}${FINE}%`;

export function duree(ms: number): string {
  if (!Number.isFinite(ms)) return "–";
  if (ms < 1000) return `${nombre(Math.round(ms))}${INSECABLE}ms`;
  if (ms < 10_000) return `${decimal(ms / 1000, 2)}${INSECABLE}s`;
  if (ms < 60_000) return `${decimal(ms / 1000, 1)}${INSECABLE}s`;
  const minutes = Math.floor(ms / 60_000);
  const secondes = Math.round((ms % 60_000) / 1000);
  return `${minutes}${INSECABLE}min${secondes > 0 ? ` ${secondes}${INSECABLE}s` : ""}`;
}

// Un temps écoulé, à la seconde : pour une horloge qui avance
export function secondes(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}${INSECABLE}s`;
  return `${Math.floor(s / 60)}${INSECABLE}min ${String(s % 60).padStart(2, "0")}${INSECABLE}s`;
}

// Un coût en dollars : quatre chiffres significatifs au plus pour les petits montants (« 0,0038 $ »)
export function cout(dollars: number): string {
  if (dollars === 0) return `0${INSECABLE}$`;
  if (dollars >= 1) return `${avec(2, 2).format(dollars)}${INSECABLE}$`;
  const chiffres = Math.min(6, Math.max(2, 1 - Math.floor(Math.log10(dollars)) + 1));
  return `${avec(0, chiffres).format(dollars)}${INSECABLE}$`;
}

export const coutFourchette = (c: { min: number; max: number }) =>
  Math.abs(c.max - c.min) < 1e-9 ? cout(c.min) : `${cout(c.min)} à ${cout(c.max)}`;

export const tokens = (n: number) => `${nombre(n)}${INSECABLE}token${n >= 2 ? "s" : ""}`;

// « 1 passage », « 0 passage », « 3 passages » : en français, 0 et 1 sont au singulier
export const pluriel = (n: number, singulier: string, forme = `${singulier}s`) => `${nombre(n)}${INSECABLE}${n >= 2 ? forme : singulier}`;

// Une date AAAA-MM-JJ, lue comme un jour local (et non à minuit UTC, qui la décalerait d'un jour à l'ouest)
const jour = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const jourCourt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" });
function lireJour(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
// « 1er mars 2026 » : le premier du mois s'écrit avec son ordinal
const premier = (texte: string) => texte.replace(/^1 /, "1er ");
export const date = (iso: string) => {
  const d = lireJour(iso);
  return d ? premier(jour.format(d)) : iso;
};
export const dateCourte = (iso: string) => {
  const d = lireJour(iso);
  return d ? premier(jourCourt.format(d)) : iso;
};

// Les sites d'un document : aucun (ou null, quand le document ne le précise pas), c'est tous
export const nomsDesSites = (sites: readonly string[] | null | undefined) =>
  !sites || sites.length === 0 ? "tous" : sites.map((s) => s.charAt(0).toLocaleUpperCase("fr") + s.slice(1)).join(", ");

export const aujourdhui = () => new Date().toLocaleDateString("sv-SE");

// La typographie française d'un texte venu du serveur (un résumé d'étape) : espace insécable avant les deux-points,
// espace fine insécable avant ; ! ?, et dans les guillemets. Pour l'affichage seulement : les données restent intactes
export function typographie(texte: string): string {
  return texte
    .replace(/ :(?=\s|$)/g, `${INSECABLE}:`)
    .replace(/ ([;!?])/g, `${FINE}$1`)
    .replace(/« /g, `«${INSECABLE}`)
    .replace(/ »/g, `${INSECABLE}»`);
}
