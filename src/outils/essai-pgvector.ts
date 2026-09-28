// Premier essai de pgvector : trois passages, une question, les plus proches d'abord.
// Lancement : npm run essai:pgvector (la base doit tourner : npm run db:up)
import pgvector from "pgvector/pg";
import { pool } from "../db.ts";

const client = await pool.connect();

// Une table temporaire : elle disparaît quand la connexion se ferme
await client.query("CREATE TEMP TABLE passages (id serial PRIMARY KEY, texte text, embedding vector(3))");

// Des vecteurs fictifs à trois dimensions, pour voir le principe
const passages: [string, number[]][] = [
  ["Jours de télétravail par semaine", [0.8, 0.6, 0]],
  ["Congés payés par an", [0, 0.6, 0.8]],
  ["Plafond d'un repas avec un client", [-0.8, 0.6, 0]],
];
for (const [texte, embedding] of passages) {
  await client.query("INSERT INTO passages (texte, embedding) VALUES ($1, $2)", [texte, pgvector.toSql(embedding)]);
}

// <=> calcule la distance cosinus, c'est-à-dire 1 moins la similarité cosinus
const question = [0.6, 0.8, 0]; // « Combien de jours puis-je travailler de chez moi ? »
const { rows } = await client.query<{ texte: string; distance: number }>(
  "SELECT texte, embedding <=> $1 AS distance FROM passages ORDER BY embedding <=> $1 LIMIT 3",
  [pgvector.toSql(question)],
);
for (const ligne of rows) {
  console.log(`similarité ${(1 - ligne.distance).toFixed(2)}  ${ligne.texte}`);
}

client.release();
await pool.end();
