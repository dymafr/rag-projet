// Connexion à PostgreSQL, avec la prise en charge du type vector de pgvector
import pg from "pg";
import pgvector from "pgvector/pg";
import { config } from "./config.ts";

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  // À chaque nouvelle connexion, le client apprend à lire et à écrire le type vector
  onConnect: async (client) => pgvector.registerTypes(client),
});
