// Recherche vectorielle dans PostgreSQL : les k chunks les plus proches de la question, filtrés par leurs métadonnées
import pgvector from "pgvector/pg";
import type { Base } from "../stockage/base.ts";

export type Filtres = {
  sites?: string[]; // au moins un de ces sites
  types?: string[]; // politique, accord, faq, intranet ou ticket
  langue?: string; // fr ou en
  enVigueurLe?: string; // une date, AAAA-MM-JJ : seulement les documents qui s'appliquaient ce jour-là
  acces?: string[]; // tous, manager ou rh : qui a le droit de lire le document
};

export type Resultat = { id: string; document: string; titres: string[]; texte: string; score: number };

// La requête SQL et ses valeurs. Le vecteur de la question est $1, chaque filtre ajoute une condition au WHERE
export function requete(vecteur: number[], k: number, filtres: Filtres = {}) {
  const valeurs: unknown[] = [pgvector.toSql(vecteur)];
  const conditions: string[] = [];
  const filtrer = (condition: (parametre: string) => string, valeur: unknown) => {
    valeurs.push(valeur);
    conditions.push(condition(`$${valeurs.length}`));
  };
  if (filtres.sites?.length) filtrer((p) => `sites && ${p}`, filtres.sites); // && : au moins un site en commun
  if (filtres.types?.length) filtrer((p) => `type = ANY(${p})`, filtres.types);
  if (filtres.langue) filtrer((p) => `langue = ${p}`, filtres.langue);
  // En vigueur à cette date : le document s'applique déjà, et aucun texte plus récent ne l'a encore remplacé
  if (filtres.enVigueurLe) filtrer((p) => `date_effet <= ${p} AND (date_fin IS NULL OR date_fin > ${p})`, filtres.enVigueurLe);
  if (filtres.acces?.length) filtrer((p) => `acces = ANY(${p})`, filtres.acces);
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  // <=> est la distance cosinus : trier sur elle, en ordre croissant, permet à PostgreSQL d'utiliser l'index HNSW
  const sql = `SELECT id, document, titres, texte, 1 - (embedding <=> $1) AS score
    FROM chunks ${where}
    ORDER BY embedding <=> $1
    LIMIT ${Math.trunc(k)}`;
  return { sql, valeurs };
}

export async function chercher(base: Base, vecteur: number[], k = 5, filtres: Filtres = {}): Promise<Resultat[]> {
  const { sql, valeurs } = requete(vecteur, k, filtres);
  const { rows } = await base.query<Resultat>(sql, valeurs);
  return rows;
}
