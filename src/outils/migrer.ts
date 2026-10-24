// Préparer la base (chapitre 14, leçon 10) : tout ce que Rhéa attend d'elle, sauf les passages (l'ingestion les écrit).
// Chaque étape est idempotente : relancée sur une base prête, elle ne change rien. C'est ce qui permet de la lancer à
// chaque démarrage, en premier (le service migrations du compose de production), sans se demander si c'est déjà fait.
// Les scripts de docker-entrypoint-initdb.d, eux, ne tournent qu'une fois, à la création du volume : ce ne sont pas des
// migrations. Lancement : npm run migrer
import { readFile } from "node:fs/promises";
import pg from "pg";
import { config } from "../config.ts";
import { pool } from "../db.ts";
import { creerObservations } from "../observabilite/observations.ts";
import { SCHEMA_DEMANDES } from "../rh/donnees.ts";
import { preparerAcces } from "../sql/acces.ts";
import { creerFile } from "../taches/file.ts";

// Les extensions : le type vector (pgvector) et unaccent, pour la recherche plein texte du chapitre 9. Par une connexion
// à part : le pool du projet apprend le type vector à chaque nouvelle connexion (db.ts), et ne peut donc pas se
// connecter à une base neuve, qui ne l'a pas encore
async function creerExtensions() {
  const client = new pg.Client({ connectionString: config.DATABASE_URL });
  await client.connect();
  try {
    await client.query("CREATE EXTENSION IF NOT EXISTS vector");
    await client.query("CREATE EXTENSION IF NOT EXISTS unaccent");
  } finally {
    await client.end();
  }
}

const etapes: [string, () => Promise<unknown>][] = [
  ["extensions", creerExtensions],
  // L'annuaire et les soldes (chapitre 10) : chargés une seule fois, jamais écrasés
  ["annuaire et soldes", async () => {
    const { rows } = await pool.query<{ existe: boolean }>("SELECT to_regclass('salaries') IS NOT NULL AS existe");
    if (!rows[0].existe) await pool.query(await readFile("corpus/soldes/soldes.sql", "utf8"));
  }],
  ["demandes de l'espace RH", () => pool.query(SCHEMA_DEMANDES)],
  ["accès du text-to-SQL (rôle, sécurité par ligne)", () => preparerAcces(pool)], // chapitre 12
  ["file des tâches", () => creerFile(pool)], // leçon 1
  ["observations et retours", () => creerObservations(pool)], // leçon 7
];

try {
  for (const [nom, faire] of etapes) {
    await faire();
    console.log(`ok  ${nom}`);
  }
  console.log("Base prête. Les passages viennent ensuite de l'ingestion (ingest, decouper, indexer).");
} finally {
  await pool.end();
}
