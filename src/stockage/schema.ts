// La table des chunks : le texte, d'où il vient, les métadonnées qui serviront de filtres, et le vecteur
import type { Base } from "./base.ts";

// vector : 4 octets par dimension. halfvec : 2 octets, avec une précision moindre
export type Stockage = "vector" | "halfvec";

export async function creerTable(base: Base, dimension: number, stockage: Stockage = "vector") {
  await base.query(`
    CREATE TABLE IF NOT EXISTS chunks (
      id text PRIMARY KEY,         -- POL-NF-01#4
      document text NOT NULL,      -- POL-NF-01, l'identifiant que Rhéa citera
      titres text[] NOT NULL,      -- le chemin de titres de la section
      texte text NOT NULL,
      taille integer NOT NULL,     -- en tokens
      type text NOT NULL,          -- politique, accord, faq, intranet ou ticket
      acces text NOT NULL,         -- tous, manager ou rh
      langue text NOT NULL,        -- fr ou en
      sites text[] NOT NULL,       -- lyon, nantes
      date_effet date NOT NULL,
      embedding ${stockage}(${dimension}) NOT NULL
    )`);
}

// L'index HNSW : un graphe où chaque vecteur est relié à ses voisins proches. La recherche le parcourt
// au lieu de comparer la question à chaque ligne. m et ef_construction gardent ici les valeurs par défaut de pgvector.
// Un index HNSW accepte 2 000 dimensions au plus en vector, 4 000 en halfvec
export async function creerIndex(base: Base, stockage: Stockage = "vector") {
  await base.query(`CREATE INDEX IF NOT EXISTS chunks_embedding_idx ON chunks
    USING hnsw (embedding ${stockage}_cosine_ops) WITH (m = 16, ef_construction = 64)`);
}
