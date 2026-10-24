// L'observabilité de Rhéa en production (chapitre 14, leçon 7) : une ligne par question, avec ce qu'il faut pour suivre le
// service jour après jour (combien de questions, de réponses sans source, de réponses dégradées, quelle latence, quel
// coût, quels retours des salariés) et détecter une dérive (le meilleur score de la recherche qui baisse : les questions
// s'éloignent du corpus ; les réponses sans source qui augmentent). L'agent refuse par une phrase, pas par un drapeau :
// en production, sans juge, « aucune source citée » est ce qu'on sait mesurer de plus proche d'une abstention. Chapitre 13, leçon 4 : comme le journal, une observation garde des références,
// jamais des données. Ni le texte de la question (une empreinte suffit à regrouper les questions répétées), ni celui des
// passages ou de la réponse, ni le matricule (un pseudonyme). La trace complète, elle, ne vit que dans l'interface
// d'inspection, en développement. Une observation vit aussi longtemps que le journal : six mois
import { createHmac } from "node:crypto";
import type { Base } from "../stockage/base.ts";
import type { EtapeTracee } from "../trace/trace.ts";

export const SCHEMA_OBSERVATIONS = `
CREATE TABLE IF NOT EXISTS observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  horodatage timestamptz NOT NULL DEFAULT now(),
  pseudonyme text NOT NULL,
  profil text NOT NULL,
  question text NOT NULL,
  statut text NOT NULL CHECK (statut IN ('citee', 'sans-source', 'degradee', 'erreur')),
  duree_ms integer NOT NULL,
  tours integer NOT NULL,
  tokens_entree integer NOT NULL,
  tokens_en_cache integer NOT NULL,
  tokens_sortie integer NOT NULL,
  cout double precision,
  modele text NOT NULL,
  meilleur_score real,
  citees text[] NOT NULL,
  outils text[] NOT NULL,
  etapes jsonb NOT NULL
)`;
export const SCHEMA_RETOURS = `
CREATE TABLE IF NOT EXISTS retours (
  observation uuid PRIMARY KEY REFERENCES observations ON DELETE CASCADE,
  horodatage timestamptz NOT NULL DEFAULT now(),
  note smallint NOT NULL CHECK (note IN (-1, 1)),
  commentaire text
)`;
export const INDEX_OBSERVATIONS = "CREATE INDEX IF NOT EXISTS observations_horodatage ON observations (horodatage)";

export async function creerObservations(base: Base) {
  await base.query(SCHEMA_OBSERVATIONS);
  await base.query(SCHEMA_RETOURS);
  await base.query(INDEX_OBSERVATIONS);
}

// L'empreinte d'une question : la même question, aux majuscules et aux espaces près, donne la même empreinte. Courte : elle
// sert à compter les questions répétées, pas à les retrouver. Calculée avec la clé du journal (un HMAC, comme le
// pseudonyme, chapitre 13) : sans la clé, une question courte et fréquente ne se devine pas en essayant des questions
export const empreinteDeQuestion = (question: string, cle: Buffer) =>
  createHmac("sha256", cle).update(question.trim().toLowerCase().replace(/\s+/g, " ")).digest("hex").slice(0, 16);

// Ce que la trace devient en production : le nom, la durée et le statut de chaque étape, et les seuls nombres qui ne disent
// rien de la question (les tokens, le meilleur score). Pas de résumé : il peut citer la question condensée ou un solde
export const etapesSansDonnees = (etapes: EtapeTracee[]) =>
  etapes.map(({ id, parent, nom, duree_ms, statut, usage, modele }) => ({ id, parent, nom, duree_ms, statut, ...(usage && { usage }), ...(modele && { modele }) }));

// Une source peut porter un matricule (la fiche d'organigramme ORGANIGRAMME-K0035#1), un commentaire aussi : il passe sous
// pseudonyme, comme dans le journal du chapitre 13. masquer reçoit un matricule et rend son pseudonyme
export const sansMatricule = (texte: string, masquer: (matricule: string) => string) => texte.replace(/\bK\d{4}\b/g, masquer);
export const sourcesSansMatricule = (citees: string[], masquer: (matricule: string) => string) => citees.map((id) => sansMatricule(id, masquer));

// citee : au moins une source citée ; sans-source : aucune (un refus, une information absente, ou une réponse tirée d'un
// outil comme le solde de congés) ; degradee : aucun LLM n'a répondu (leçon 8) ; erreur : la question a échoué
export type Statut = "citee" | "sans-source" | "degradee" | "erreur";
export type Observation = {
  pseudonyme: string;
  profil: string;
  question: string; // en clair ici, jamais en base : seule son empreinte y entre
  statut: Statut;
  duree_ms: number;
  tours: number;
  usage: { entree: number; enCache: number; sortie: number };
  cout: number | null;
  modele: string;
  citees: string[];
  outils: string[];
  etapes: EtapeTracee[];
};

// Le meilleur score de la recherche pendant la question : celui du seuil d'abstention (chapitre 7), noté par chercher_documents
export function meilleurScore(etapes: EtapeTracee[]): number | null {
  const scores = etapes.filter((e) => e.nom === "seuil").map((e) => Number(e.details.meilleur));
  return scores.length > 0 ? Math.max(...scores) : null;
}

// cle : la clé du journal (chapitre 13), pour l'empreinte de la question
export async function enregistrer(base: Base, o: Observation, cle: Buffer): Promise<string> {
  const { rows } = await base.query<{ id: string }>(
    `INSERT INTO observations (pseudonyme, profil, question, statut, duree_ms, tours, tokens_entree, tokens_en_cache, tokens_sortie, cout, modele, meilleur_score, citees, outils, etapes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
    [o.pseudonyme, o.profil, empreinteDeQuestion(o.question, cle), o.statut, o.duree_ms, o.tours, o.usage.entree, o.usage.enCache, o.usage.sortie, o.cout, o.modele, meilleurScore(o.etapes), o.citees, o.outils, JSON.stringify(etapesSansDonnees(o.etapes))],
  );
  return rows[0].id;
}

// Le retour d'un salarié sur une réponse (pouce levé ou baissé, et un commentaire facultatif, borné et caviardé par
// l'appelant). Seul celui qui a posé la question peut noter sa réponse ; noter une seconde fois remplace la note
export async function retour(base: Base, observation: string, pseudonyme: string, note: -1 | 1, commentaire: string | null): Promise<boolean> {
  const { rows } = await base.query<{ observation: string }>(
    `INSERT INTO retours (observation, note, commentaire)
     SELECT id, $3, $4 FROM observations WHERE id = $1 AND pseudonyme = $2
     ON CONFLICT (observation) DO UPDATE SET note = EXCLUDED.note, commentaire = EXCLUDED.commentaire, horodatage = now()
     RETURNING observation`,
    [observation, pseudonyme, note, commentaire],
  );
  return rows.length > 0;
}

// Les indicateurs par jour, sur les derniers jours : de quoi voir une tendance, et une dérive
export type Jour = {
  jour: string;
  questions: number;
  sans_source: number;
  degradees: number;
  erreurs: number;
  latence_p50: number | null;
  latence_p95: number | null;
  cout: number | null;
  meilleur_score: number | null; // la moyenne
  retours_positifs: number;
  retours_negatifs: number;
};

export async function parJour(base: Base, jours = 30): Promise<Jour[]> {
  const { rows } = await base.query<Jour>(
    `SELECT to_char(o.horodatage, 'YYYY-MM-DD') AS jour,
       count(*)::int AS questions,
       count(*) FILTER (WHERE statut = 'sans-source')::int AS sans_source,
       count(*) FILTER (WHERE statut = 'degradee')::int AS degradees,
       count(*) FILTER (WHERE statut = 'erreur')::int AS erreurs,
       percentile_disc(0.5) WITHIN GROUP (ORDER BY duree_ms) AS latence_p50,
       percentile_disc(0.95) WITHIN GROUP (ORDER BY duree_ms) AS latence_p95,
       sum(cout) AS cout,
       avg(meilleur_score)::real AS meilleur_score,
       count(r.note) FILTER (WHERE r.note = 1)::int AS retours_positifs,
       count(r.note) FILTER (WHERE r.note = -1)::int AS retours_negatifs
     FROM observations o LEFT JOIN retours r ON r.observation = o.id
     WHERE o.horodatage >= now() - make_interval(days => $1)
     GROUP BY 1 ORDER BY 1`,
    [jours],
  );
  return rows;
}

// La dérive : les 7 derniers jours comparés aux 28 d'avant. Une alerte quand la part des réponses sans source monte de
// plus de 5 points, ou quand le meilleur score moyen baisse de plus de 0,03 (sur un cosinus : un décalage net), ou quand la part
// de retours négatifs dépasse 20 %. Des seuils à régler sur votre propre historique ; ils disent où regarder, pas quoi
// corriger : une dérive se comprend en relisant des questions récentes avec l'inspection
export function derive(jours: Jour[], aujourdhui: string) {
  const depuis = (n: number) => new Date(new Date(`${aujourdhui}T00:00:00Z`).getTime() - n * 86_400_000).toISOString().slice(0, 10);
  const recents = jours.filter((j) => j.jour > depuis(7));
  const avant = jours.filter((j) => j.jour <= depuis(7) && j.jour > depuis(35));
  const resumer = (liste: Jour[]) => {
    const questions = liste.reduce((s, j) => s + j.questions, 0);
    const scores = liste.filter((j) => j.meilleur_score !== null);
    const retours = liste.reduce((s, j) => s + j.retours_positifs + j.retours_negatifs, 0);
    return {
      questions,
      sansSource: questions ? liste.reduce((s, j) => s + j.sans_source, 0) / questions : null,
      meilleurScore: scores.length ? scores.reduce((s, j) => s + j.meilleur_score! * j.questions, 0) / scores.reduce((s, j) => s + j.questions, 0) : null,
      negatifs: retours ? liste.reduce((s, j) => s + j.retours_negatifs, 0) / retours : null,
    };
  };
  const r = resumer(recents);
  const a = resumer(avant);
  const alertes: string[] = [];
  if (r.sansSource !== null && a.sansSource !== null && r.sansSource - a.sansSource > 0.05) alertes.push("la part des réponses sans source monte");
  if (r.meilleurScore !== null && a.meilleurScore !== null && a.meilleurScore - r.meilleurScore > 0.03) alertes.push("le meilleur score de la recherche baisse");
  if (r.negatifs !== null && r.negatifs > 0.2) alertes.push("plus d'un retour sur cinq est négatif");
  return { recents: r, avant: a, alertes };
}

// Effacer les observations plus vieilles que la durée de conservation (les retours partent avec elles)
export async function purgerObservations(base: Base, jours = 184): Promise<number> {
  const { rows } = await base.query("DELETE FROM observations WHERE horodatage < now() - make_interval(days => $1) RETURNING id", [jours]);
  return rows.length;
}
