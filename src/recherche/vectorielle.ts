// Recherche vectorielle dans PostgreSQL : les k chunks les plus proches de la question, filtrés par leurs métadonnées
import pgvector from "pgvector/pg";
import type { Base } from "../stockage/base.ts";

export type Filtres = {
  sites?: string[]; // au moins un de ces sites
  types?: string[]; // politique, accord, faq, intranet ou ticket
  langue?: string; // fr ou en
  enVigueurLe?: string; // une date, AAAA-MM-JJ : seulement les documents qui s'appliquaient ce jour-là
  // tous, manager ou rh : les niveaux que le lecteur a le droit de lire (droits.ts). Obligatoire (chapitre 13) : une
  // recherche qui l'oublierait montrerait tout
  acces: string[];
};

export type Resultat = { id: string; document: string; titres: string[]; texte: string; score: number };

// Les conditions SQL des filtres, à mettre dans le WHERE. Chaque valeur s'ajoute à valeurs et prend le numéro de
// paramètre suivant : la recherche plein texte (chapitre 9) partage ces filtres avec la recherche vectorielle
export function conditions(filtres: Filtres, valeurs: unknown[]): string[] {
  // Le type l'exige déjà ; ce test couvre ce que le compilateur ne voit pas (une liste vide, un objet venu d'un JSON, où
  // une chaîne prendrait la place de la liste). Sans niveau d'accès, on refuse de chercher, plutôt que de chercher partout
  if (!Array.isArray(filtres.acces) || filtres.acces.length === 0) throw new Error("Recherche refusée : aucun niveau d'accès dans les filtres");
  const liste: string[] = [];
  const filtrer = (condition: (parametre: string) => string, valeur: unknown) => {
    valeurs.push(valeur);
    liste.push(condition(`$${valeurs.length}`));
  };
  if (filtres.sites?.length) filtrer((p) => `sites && ${p}`, filtres.sites); // && : au moins un site en commun
  if (filtres.types?.length) filtrer((p) => `type = ANY(${p})`, filtres.types);
  if (filtres.langue) filtrer((p) => `langue = ${p}`, filtres.langue);
  // En vigueur à cette date : le document s'applique déjà, et aucun texte plus récent ne l'a encore remplacé
  if (filtres.enVigueurLe) filtrer((p) => `date_effet <= ${p} AND (date_fin IS NULL OR date_fin > ${p})`, filtres.enVigueurLe);
  filtrer((p) => `acces = ANY(${p})`, filtres.acces);
  return liste;
}

// La requête SQL et ses valeurs. Le vecteur de la question est $1, chaque filtre ajoute une condition au WHERE (il y en
// a toujours une : le niveau d'accès)
export function requete(vecteur: number[], k: number, filtres: Filtres) {
  const valeurs: unknown[] = [pgvector.toSql(vecteur)];
  const where = `WHERE ${conditions(filtres, valeurs).join(" AND ")}`;
  // <=> est la distance cosinus : trier sur elle, en ordre croissant, permet à PostgreSQL d'utiliser l'index HNSW
  const sql = `SELECT id, document, titres, texte, 1 - (embedding <=> $1) AS score
    FROM chunks ${where}
    ORDER BY embedding <=> $1
    LIMIT ${Math.trunc(k)}`;
  return { sql, valeurs };
}

export async function chercher(base: Base, vecteur: number[], k: number, filtres: Filtres): Promise<Resultat[]> {
  const { sql, valeurs } = requete(vecteur, k, filtres);
  const { rows } = await base.query<Resultat>(sql, valeurs);
  return rows;
}

// La similarité cosinus de passages donnés par leur identifiant : pour ceux qu'une autre recherche a trouvés (chapitre 9)
export async function similarites(base: Base, vecteur: number[], ids: string[]): Promise<Resultat[]> {
  if (ids.length === 0) return [];
  const { rows } = await base.query<Resultat>(
    "SELECT id, document, titres, texte, 1 - (embedding <=> $1) AS score FROM chunks WHERE id = ANY($2)",
    [pgvector.toSql(vecteur), ids],
  );
  return rows;
}

// Les vecteurs de passages donnés par leur identifiant : pour comparer les passages entre eux (chapitre 9). Le client pg
// les rend en tableaux (pgvector.registerTypes) ; PGlite, en texte « [0.01,-0.02,…] », qui se lit comme du JSON
export async function vecteurs(base: Base, ids: string[]): Promise<Map<string, number[]>> {
  const { rows } = await base.query<{ id: string; embedding: number[] | string }>("SELECT id, embedding FROM chunks WHERE id = ANY($1)", [ids]);
  return new Map(rows.map((r) => [r.id, typeof r.embedding === "string" ? (JSON.parse(r.embedding) as number[]) : r.embedding]));
}
