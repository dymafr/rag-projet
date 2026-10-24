// Le calendrier de Kalyo (chapitre 14, leçon 5) : les jours d'une période, leur jour de la semaine, les jours fériés lus
// dans la page de l'intranet (INT-JOURS-FERIES) et le compte des jours ouvrés. Un LLM se trompe en comptant des jours
// (une semaine de Noël comptée sept jours au lieu de huit, un mercredi férié pris pour un mercredi ordinaire) : comme
// pour l'indemnité kilométrique (chapitre 10), le code compte, le LLM explique

export type JourFerie = { date: string; fete: string; chome: boolean; chezKalyo: string };
export type Jour = { date: string; libelle: string; statut: "ouvré" | "week-end" | "férié chômé" | "férié travaillé"; fete?: string };

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const LIBELLE = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

// « lundi 21 décembre 2026 » : les dates sont des jours (AAAA-MM-JJ), sans heure, lus en UTC pour ne dépendre d'aucun fuseau
export const libelleDuJour = (date: string) => LIBELLE.format(new Date(`${date}T00:00:00Z`));
const lendemain = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

// Le tableau de la page : « | 25 décembre | vendredi | Noël | Chômé | », l'année venant du titre (« Jours fériés 2026 »)
export function lireJoursFeries(texte: string): JourFerie[] {
  const annee = /Jours fériés (\d{4})/.exec(texte)?.[1];
  if (!annee) return [];
  const feries: JourFerie[] = [];
  for (const ligne of texte.split("\n")) {
    const m = /^\|\s*(\d{1,2})(?:er)?\s+([a-zéû]+)\s*\|[^|]*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/i.exec(ligne.trim());
    const mois = m ? MOIS.indexOf(m[2].toLowerCase()) : -1;
    if (!m || mois < 0) continue;
    const date = `${annee}-${String(mois + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    feries.push({ date, fete: m[3], chome: /^chômé/i.test(m[4]), chezKalyo: m[4] });
  }
  return feries;
}

// Les jours de du à au (inclus), et les jours ouvrés : du lundi au vendredi, hors jours fériés chômés, comme les congés
// payés se décomptent (politique congés et absences). Un jour férié travaillé (la journée de solidarité) reste ouvré
export function calendrier(du: string, au: string, feries: JourFerie[]): { jours: Jour[]; ouvres: number } {
  const parDate = new Map(feries.map((f) => [f.date, f]));
  const jours: Jour[] = [];
  for (let d = du; d <= au; d = lendemain(d)) {
    const semaine = new Date(`${d}T00:00:00Z`).getUTCDay(); // 0 : dimanche, 6 : samedi
    const f = parDate.get(d);
    const statut = semaine === 0 || semaine === 6 ? "week-end" : f?.chome ? "férié chômé" : f ? "férié travaillé" : "ouvré";
    jours.push({ date: d, libelle: libelleDuJour(d), statut, ...(f && { fete: f.fete }) });
  }
  return { jours, ouvres: jours.filter((j) => j.statut === "ouvré" || j.statut === "férié travaillé").length };
}
