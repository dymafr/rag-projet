// Les données RH que Rhéa peut lire ou écrire par ses outils, dans la même base que les passages : les salariés fictifs
// de Kalyo et leurs soldes (corpus/soldes/soldes.sql), et les demandes que Rhéa ouvre dans l'espace RH.
// Toujours des requêtes paramétrées ($1, $2…) : une valeur venue du LLM ne devient jamais du SQL
import type { Base } from "../stockage/base.ts";

// Les catégories de tickets de l'espace RH de Kalyo
export const CATEGORIES = [
  "Paie",
  "Congés et absences",
  "Notes de frais",
  "Télétravail",
  "Mutuelle et prévoyance",
  "Formation",
  "Mobilité",
  "Transport",
  "Astreintes",
  "Autre",
] as const;

export const SCHEMA_DEMANDES = `
CREATE TABLE IF NOT EXISTS demandes_rh (
  id         serial PRIMARY KEY,
  matricule  text NOT NULL REFERENCES salaries (matricule),
  categorie  text NOT NULL,
  objet      text NOT NULL,
  message    text NOT NULL,
  statut     text NOT NULL DEFAULT 'ouverte',
  ouverte_le timestamptz NOT NULL DEFAULT now()
)`;

export type Solde = {
  matricule: string;
  forfait_jours: boolean;
  cp_reliquat: number;
  cp_en_cours: number;
  rtt_acquis: number;
  rtt_pris: number;
  maj_le: string;
};

// Le solde d'un salarié, ou null s'il n'existe pas. numeric arrive en texte avec pg : on le convertit
export async function lireSolde(base: Base, matricule: string): Promise<Solde | null> {
  const { rows } = await base.query<Record<string, unknown>>(
    `SELECT s.matricule, a.forfait_jours, s.cp_reliquat, s.cp_en_cours, s.rtt_acquis, s.rtt_pris, to_char(s.maj_le, 'YYYY-MM-DD') AS maj_le
       FROM soldes s JOIN salaries a USING (matricule) WHERE s.matricule = $1`,
    [matricule],
  );
  const l = rows[0];
  if (!l) return null;
  return {
    matricule: String(l.matricule),
    forfait_jours: Boolean(l.forfait_jours),
    cp_reliquat: Number(l.cp_reliquat),
    cp_en_cours: Number(l.cp_en_cours),
    rtt_acquis: Number(l.rtt_acquis),
    rtt_pris: Number(l.rtt_pris),
    maj_le: String(l.maj_le),
  };
}

export type Profil = {
  matricule: string;
  site: string;
  service: string;
  poste: string;
  manager: string | null;
  date_entree: string;
  temps_travail: number;
  forfait_jours: boolean;
};

// La situation d'un salarié (leçon 4) : son poste, son manager (une jointure de la table sur elle-même), son entrée
export async function lireProfil(base: Base, matricule: string): Promise<Profil | null> {
  const { rows } = await base.query<Profil>(
    `SELECT a.matricule, a.site, a.service, a.poste, m.prenom || ' ' || m.nom AS manager,
            to_char(a.date_entree, 'YYYY-MM-DD') AS date_entree, a.temps_travail, a.forfait_jours
       FROM salaries a LEFT JOIN salaries m ON m.matricule = a.manager WHERE a.matricule = $1`,
    [matricule],
  );
  return rows[0] ?? null;
}

// L'ancienneté en mois révolus à une date (AAAA-MM-JJ) : un mois compte quand son jour anniversaire est atteint, ou
// le dernier jour d'un mois trop court (entré un 31 : le 30 avril). Un calcul de dates ne se confie pas au LLM non plus
export function moisRevolus(debut: string, date: string): number {
  const [a1, m1, j1] = debut.split("-").map(Number);
  const [a2, m2, j2] = date.split("-").map(Number);
  const anniversaire = Math.min(j1, new Date(Date.UTC(a2, m2, 0)).getUTCDate()); // Date.UTC(a, m, 0) : le dernier jour du mois m
  return Math.max(0, (a2 - a1) * 12 + (m2 - m1) - (j2 < anniversaire ? 1 : 0)); // 0 avant la date d'entrée
}

export async function ouvrirDemande(base: Base, demande: { matricule: string; categorie: string; objet: string; message: string }): Promise<number> {
  const { rows } = await base.query<{ id: number }>(
    "INSERT INTO demandes_rh (matricule, categorie, objet, message) VALUES ($1, $2, $3, $4) RETURNING id",
    [demande.matricule, demande.categorie, demande.objet, demande.message],
  );
  return rows[0].id;
}
