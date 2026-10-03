// Chercher dans PostgreSQL les chunks les plus proches d'une question, avec des filtres sur les métadonnées
// Lancement : npm run rechercher -- "votre question" [--k 5] [--site lyon] [--type politique] [--langue fr] [--plan]
//             [--date 2026-01-15] (les règles en vigueur ce jour-là ; par défaut aujourd'hui) [--toutes-versions]
//             options de démonstration : --index (passer par l'index HNSW, comme sur une grande table), --sans-iteratif
import { parseArgs } from "node:util";
import { pool } from "../db.ts";
import { nomDuModele, vectoriser } from "../embeddings/fournisseurs.ts";
import { chercher, requete, type Filtres } from "../recherche/vectorielle.ts";
import { lireIndexation } from "../stockage/schema.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    k: { type: "string", default: "5" }, // nombre de chunks renvoyés
    site: { type: "string", multiple: true }, // --site lyon --site nantes
    type: { type: "string", multiple: true }, // --type politique --type accord
    langue: { type: "string" },
    date: { type: "string", default: new Date().toLocaleDateString("sv-SE") }, // aujourd'hui, à l'heure locale (sv-SE écrit AAAA-MM-JJ)
    "toutes-versions": { type: "boolean", default: false }, // garder aussi les textes remplacés
    plan: { type: "boolean", default: false }, // afficher comment PostgreSQL a mené la recherche
    index: { type: "boolean", default: false },
    "sans-iteratif": { type: "boolean", default: false },
  },
});
const question = positionals[0] ?? "Combien de jours de télétravail par semaine ?";
const k = Number(values.k);
if (!Number.isInteger(k) || k < 1) {
  console.error(`--k attend un nombre entier positif, pas « ${values.k} »`);
  process.exit(1);
}
const filtres: Filtres = { sites: values.site, types: values.type, langue: values.langue };
if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date)) {
  console.error(`--date attend une date au format AAAA-MM-JJ, pas « ${values.date} »`);
  process.exit(1);
}
if (!values["toutes-versions"]) filtres.enVigueurLe = values.date;
const apercu = (texte: string) => texte.replace(/\n+/g, " ↵ ").slice(0, 70);

const client = await pool.connect(); // une seule connexion : les réglages SET valent pour les requêtes qui suivent
// Sur quelques centaines de lignes, PostgreSQL estime plus rapide de lire toute la table que de passer par l'index.
// enable_seqscan = off l'en dissuade s'il a un autre choix : il passe alors par l'index,
// comme il le ferait de lui-même sur une grande table
if (values.index) await client.query("SET enable_seqscan = off");
if (values["sans-iteratif"]) await client.query("SET hnsw.iterative_scan = off");

// La question doit être vectorisée par le modèle qui a calculé les vecteurs de la base
const indexation = await lireIndexation(client);
if (indexation && indexation.modele !== nomDuModele()) {
  console.error(`La base a été indexée avec ${indexation.modele}, le projet est réglé sur ${nomDuModele()} : relancez npm run indexer -- --reconstruire`);
  client.release();
  await pool.end();
  process.exit(1);
}

const [vecteur] = await vectoriser([question], "requete");
const debut = performance.now();
const resultats = await chercher(client, vecteur, k, filtres);
console.log(`« ${question} »  ${JSON.stringify(filtres)}`);
console.log(`${resultats.length} chunks sur ${k} demandés, en ${(performance.now() - debut).toFixed(1)} ms\n`);
for (const { id, score, texte } of resultats) console.log(`  ${score.toFixed(3)}  ${id.padEnd(16)} ${apercu(texte)}…`);

// EXPLAIN ANALYZE exécute la requête et décrit ce que PostgreSQL a fait : parcours de la table ou de l'index, lignes écartées
if (values.plan) {
  const { sql, valeurs } = requete(vecteur, k, filtres);
  const { rows } = await client.query(`EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF) ${sql}`, valeurs);
  const lignes = rows.map((ligne) => String(ligne["QUERY PLAN"]).replace(/'\[[^\]]*\]'::(vector|halfvec)/g, () => "$1")); // le vecteur, illisible, devient $1
  console.log(`\nPlan d'exécution :\n${lignes.map((ligne) => `  ${ligne}`).join("\n")}`);
}
client.release();
await pool.end();
