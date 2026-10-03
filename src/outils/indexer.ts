// Vectoriser les chunks du chapitre 5 et les ranger dans PostgreSQL, avec les métadonnées de leur document
// Lancement : npm run indexer (la base doit tourner : npm run db:up)
//             npm run indexer -- --halfvec (vecteurs en demi-précision), npm run indexer -- --lot 1 (une requête par ligne)
import { parseArgs } from "node:util";
import { texteAVectoriser } from "../decoupage/contexte.ts";
import { lireChunks, lireDocuments } from "../decoupage/corpus.ts";
import { pool } from "../db.ts";
import { vectoriser } from "../embeddings/fournisseurs.ts";
import { insererParLots, ligne } from "../stockage/chunks.ts";
import { creerIndex, creerTable } from "../stockage/schema.ts";

const { values } = parseArgs({
  options: {
    lot: { type: "string", default: "100" }, // lignes par requête INSERT
    halfvec: { type: "boolean", default: false }, // vecteurs en demi-précision : 2 octets par dimension au lieu de 4
  },
});
const secondes = (debut: number) => ((performance.now() - debut) / 1000).toFixed(1);
const lot = Number(values.lot);
if (!Number.isInteger(lot) || lot < 1) {
  console.error(`--lot attend un nombre entier positif, pas « ${values.lot} »`);
  process.exit(1);
}

const documents = new Map((await lireDocuments()).map((document) => [document.id, document]));
const chunks = await lireChunks();
const documentDe = (id: string) => {
  const document = documents.get(id);
  if (!document) throw new Error(`Document ${id} absent de documents.jsonl : relancez npm run decouper`);
  return document;
};

// 1. Vectoriser chaque chunk, précédé de son chemin de titres (chapitre 5)
let debut = performance.now();
const vecteurs = await vectoriser(chunks.map(texteAVectoriser), "document");
const dimension = vecteurs[0].length;
console.log(`${chunks.length} chunks vectorisés en ${secondes(debut)} s (${dimension} dimensions)`);

// 2. Recréer la table : sa colonne embedding a la dimension du modèle configuré dans .env
const stockage = values.halfvec ? "halfvec" : "vector";
await pool.query("DROP TABLE IF EXISTS chunks");
await creerTable(pool, dimension, stockage);

// 3. Insérer les lignes par lots
debut = performance.now();
const lignes = chunks.map((chunk, i) => ligne(chunk, documentDe(chunk.document), vecteurs[i]));
const requetes = await insererParLots(pool, lignes, lot);
console.log(`${lignes.length} lignes insérées en ${secondes(debut)} s, en ${requetes} requêtes INSERT`);

// 4. Créer l'index une fois la table remplie : le construire en une fois va plus vite que l'enrichir ligne à ligne
debut = performance.now();
await creerIndex(pool, stockage);
console.log(`Index HNSW créé en ${secondes(debut)} s`);

const { rows } = await pool.query("SELECT pg_size_pretty(pg_total_relation_size('chunks')) AS taille");
console.log(`Table chunks, colonne embedding en ${stockage}(${dimension}) : ${rows[0].taille} sur le disque`);
await pool.end();
