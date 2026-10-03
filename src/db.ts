// Connexion à PostgreSQL, avec la prise en charge du type vector de pgvector
import pg from "pg";
import pgvector from "pgvector/pg";
import { config } from "./config.ts";

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  // À chaque nouvelle connexion, le client apprend à lire les types de pgvector (pour écrire un vecteur : pgvector.toSql).
  // Et une recherche filtrée qui passe par l'index HNSW continue de le parcourir tant qu'il lui manque des résultats,
  // dans l'ordre exact des distances, jusqu'à 20 000 lignes lues (la limite par défaut). Sans ce réglage, le filtre
  // ne s'applique qu'aux premiers candidats de l'index (40 par défaut) : il peut rester moins de k résultats
  onConnect: async (client) => {
    await pgvector.registerTypes(client);
    await client.query("SET hnsw.iterative_scan = strict_order");
  },
});
