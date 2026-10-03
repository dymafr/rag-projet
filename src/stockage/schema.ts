// La table des chunks : le texte, d'où il vient, les métadonnées qui serviront de filtres, et le vecteur
import type { Base } from "./base.ts";

// vector : 4 octets par dimension. halfvec : 2 octets, avec une précision moindre
export type Stockage = "vector" | "halfvec";

export async function creerTable(base: Base, dimension: number, stockage: Stockage = "vector", table = "chunks") {
  await base.query(`
    CREATE TABLE IF NOT EXISTS ${table} (
      id text PRIMARY KEY,         -- POL-NF-01#4
      document text NOT NULL,      -- POL-NF-01, l'identifiant que Rhéa citera
      titres text[] NOT NULL,      -- le chemin de titres de la section
      texte text NOT NULL,
      taille integer NOT NULL,     -- en tokens
      type text NOT NULL,          -- politique, accord, faq, intranet ou ticket
      acces text NOT NULL,         -- tous, manager ou rh
      langue text NOT NULL,        -- fr ou en
      sites text[] NOT NULL,       -- lyon, nantes
      date_effet date NOT NULL,    -- à partir de quand le document s'applique
      date_fin date,               -- à partir de quand un texte plus récent le remplace (vide : toujours en vigueur)
      empreinte text NOT NULL,     -- empreinte du texte vectorisé
      empreinte_meta text NOT NULL, -- empreinte des métadonnées
      embedding ${stockage}(${dimension}) NOT NULL
    )`);
}

// L'index HNSW : un graphe où chaque vecteur est relié à ses voisins proches. La recherche le parcourt
// au lieu de comparer la question à chaque ligne. m et ef_construction gardent ici les valeurs par défaut de pgvector.
// Un index HNSW accepte 2 000 dimensions au plus en vector, 4 000 en halfvec
export async function creerIndex(base: Base, stockage: Stockage = "vector", table = "chunks") {
  await base.query(`CREATE INDEX IF NOT EXISTS ${table}_embedding_idx ON ${table}
    USING hnsw (embedding ${stockage}_cosine_ops) WITH (m = 16, ef_construction = 64)`);
}

// Le modèle qui a calculé les vecteurs de la base, noté dans la table indexation (une seule ligne).
// null si la base n'a pas encore été indexée de cette façon
export type Indexation = { modele: string; dimension: number; stockage: Stockage };

export async function lireIndexation(base: Base): Promise<Indexation | null> {
  const { rows: tables } = await base.query<{ nom: string | null }>("SELECT to_regclass('indexation')::text AS nom");
  if (tables[0].nom === null) return null; // la table n'existe pas encore
  const { rows } = await base.query<Indexation>("SELECT modele, dimension, stockage FROM indexation");
  return rows[0] ?? null;
}

export async function ecrireIndexation(base: Base, { modele, dimension, stockage }: Indexation) {
  await base.query("CREATE TABLE IF NOT EXISTS indexation (modele text NOT NULL, dimension integer NOT NULL, stockage text NOT NULL)");
  await base.query("DELETE FROM indexation");
  await base.query("INSERT INTO indexation (modele, dimension, stockage) VALUES ($1, $2, $3)", [modele, dimension, stockage]);
}

// Remplace la table chunks par chunks_nouveau, reconstruite à côté. À faire dans une transaction :
// une recherche voit l'ancienne table ou la nouvelle, jamais une table à moitié remplie
export async function basculer(base: Base) {
  await base.query("DROP TABLE IF EXISTS chunks");
  await base.query("ALTER TABLE chunks_nouveau RENAME TO chunks");
  await base.query("ALTER INDEX chunks_nouveau_pkey RENAME TO chunks_pkey");
  await base.query("ALTER INDEX chunks_nouveau_embedding_idx RENAME TO chunks_embedding_idx");
}
