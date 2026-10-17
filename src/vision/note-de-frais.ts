// Lire une note de frais scannée (le formulaire NDF-03) et la contrôler. Le modèle de vision rend des champs selon un
// schéma JSON ; il peut lire de travers un chiffre manuscrit, et rien ne le signale. Le code vérifie donc ce qui se
// vérifie : la somme des lignes contre le total écrit, la vraisemblance (matricule, dates, identité), les champs
// illisibles et les plafonds de la politique notes de frais. Essai du 17 octobre sur un scan très flou : le modèle a
// inventé une note entière, avec un total cohérent ; seules les dates et l'identité trahissaient l'invention. Le
// résultat est une aide à la relecture : la note reste validée par le manager, puis contrôlée par le service finance
// et paie (POL-NF-01, article 4)
import { z } from "zod";

export const NoteDeFrais = z.object({
  nom: z.string().nullable(),
  prenom: z.string().nullable(),
  matricule: z.string().nullable(),
  objet: z.string().nullable().describe("L'objet de la mission"),
  lignes: z.array(
    z.object({
      date: z.string().nullable().describe("Telle qu'écrite, par exemple 21/03/25"),
      nature: z.string().nullable().describe("Transport, Hôtel, Repas…"),
      detail: z.string().nullable(),
      montant: z.number().nullable().describe("En euros, sans le symbole : 57,30 € donne 57.3"),
    }),
  ),
  total: z.number().nullable().describe("Le total écrit sur le formulaire, en euros"),
});
export type NoteDeFrais = z.infer<typeof NoteDeFrais>;

// Les exemples de la consigne et du schéma ne viennent jamais d'un document à lire : avec « 112,00 € », le montant de la
// première ligne de la note de Kalyo, le modèle commençait par 112 € chaque note qu'il inventait (essais du 17 octobre)
export const CONSIGNE_NOTE = `Lis cette note de frais scannée (formulaire NDF-03) et rends ses champs.
Recopie les textes tels qu'ils sont écrits. Les montants en nombres : « 57,30 € » donne 57.3.
Une ligne du tableau des dépenses par ligne remplie. Un champ illisible ou vide : null. Ne devine jamais une valeur.`;

// Les plafonds de la politique notes de frais (POL-NF-01, article 5), par personne et par repas, ou par nuit, en euros
export const PLAFONDS = {
  nuitParis: 130,
  nuitAilleurs: 95,
  repasSeul: 20,
  repasClientParis: 45,
  repasClientAilleurs: 35,
};

export type Controle = { niveau: "anomalie" | "à relire" | "dépassement"; texte: string };
const euros = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

// Une date du formulaire, 06/10/26 ou 06/10/2026, en AAAA-MM-JJ ; null si elle ne se lit pas comme une vraie date
export function lireDate(texte: string | null): string | null {
  const m = texte?.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const annee = m[3].length === 2 ? `20${m[3]}` : m[3];
  const iso = `${annee}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const jour = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(jour.getTime()) || jour.toISOString().slice(0, 10) !== iso ? null : iso;
}

const joursEntre = (debut: string, fin: string) => Math.round((Date.parse(fin) - Date.parse(debut)) / 86_400_000);

// Les contrôles. date : le jour du contrôle ; matricule : le salarié connecté, s'il est connu. Le classement d'une ligne
// (nuit, repas seul, repas avec un client) se fait par mots-clés : une règle simple, qui suffit au formulaire de Kalyo
export function controler(note: NoteDeFrais, { date, matricule }: { date: string; matricule?: string }): Controle[] {
  const controles: Controle[] = [];
  if (!note.matricule || !/^K\d{4}$/.test(note.matricule)) {
    controles.push({ niveau: "à relire", texte: `matricule illisible ou mal lu (${note.matricule ?? "vide"})` });
  } else if (matricule && note.matricule !== matricule) {
    controles.push({ niveau: "anomalie", texte: `la note est au matricule ${note.matricule}, pas à celui du salarié connecté (${matricule})` });
  }
  // « Paris » se cherche dans l'objet et dans les lignes d'hôtel ou de repas, pas dans un trajet (Nantes - Paris - Lyon)
  const sejour = note.lignes.filter((l) => /h[oô]tel|nuit|repas|d[eé]jeuner|d[iî]ner/i.test(`${l.nature ?? ""} ${l.detail ?? ""}`));
  const paris = /paris/i.test(`${note.objet ?? ""} ${sejour.map((l) => l.detail ?? "").join(" ")}`);
  for (const [i, l] of note.lignes.entries()) {
    const n = `ligne ${i + 1}`;
    const jour = lireDate(l.date);
    if (!jour) controles.push({ niveau: "à relire", texte: `${n} : date illisible (${l.date ?? "vide"})` });
    else if (jour > date) controles.push({ niveau: "anomalie", texte: `${n} : date dans le futur (${jour})` });
    else if (joursEntre(jour, date) > 30) {
      controles.push({ niveau: "anomalie", texte: `${n} : dépense du ${jour}, plus de 30 jours avant le ${date} : la note peut être refusée (POL-NF-01, article 3)` });
    }
    if (l.montant === null) {
      controles.push({ niveau: "à relire", texte: `${n} : montant illisible` });
      continue;
    }
    const texte = `${l.nature ?? ""} ${l.detail ?? ""}`.toLowerCase();
    let plafond: number | null = null;
    let quoi = "";
    if (/h[oô]tel|nuit/.test(texte)) {
      const nuits = Number(texte.match(/(\d+)\s*nuit/)?.[1] ?? 1);
      plafond = (paris ? PLAFONDS.nuitParis : PLAFONDS.nuitAilleurs) * nuits;
      quoi = `${nuits} nuit(s) d'hôtel${paris ? " à Paris" : ""}`;
    } else if (/repas|d[eé]jeuner|d[iî]ner/.test(texte) && /client|invit/.test(texte)) {
      const convives = Number(texte.match(/(\d+)\s*pers/)?.[1] ?? 1);
      plafond = (paris ? PLAFONDS.repasClientParis : PLAFONDS.repasClientAilleurs) * convives;
      quoi = `repas avec un client, ${convives} personne(s)${paris ? " à Paris" : ""}`;
    } else if (/repas|d[eé]jeuner|d[iî]ner/.test(texte)) {
      plafond = PLAFONDS.repasSeul;
      quoi = "repas seul";
    }
    if (plafond !== null && l.montant > plafond + 0.005) {
      controles.push({
        niveau: "dépassement",
        texte: `${n} (${quoi}) : ${euros(l.montant)} pour un plafond de ${euros(plafond)}, ${euros(l.montant - plafond)} resteraient à la charge du salarié (POL-NF-01, article 5)`,
      });
    }
  }
  const lus = note.lignes.map((l) => l.montant);
  if (note.total === null) controles.push({ niveau: "à relire", texte: "total illisible" });
  else if (lus.every((m) => m !== null)) {
    const somme = Math.round(lus.reduce((s, m) => s + (m ?? 0), 0) * 100) / 100;
    if (Math.abs(somme - note.total) > 0.005) {
      controles.push({ niveau: "anomalie", texte: `la somme des lignes (${euros(somme)}) ne fait pas le total écrit (${euros(note.total)}) : un montant a pu être mal lu` });
    }
  }
  if (note.lignes.length === 0) controles.push({ niveau: "à relire", texte: "aucune ligne de dépense lue" });
  return controles;
}
