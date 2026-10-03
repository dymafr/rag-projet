// Mesurer ce que valent les index HNSW et IVFFlat : le rappel (la part des vrais plus proches voisins retrouvés)
// face au temps de réponse. Les chunks de Rhéa sont trop peu nombreux pour qu'un index change quoi que ce soit :
// le banc d'essai compte 100 000 vecteurs fabriqués à partir des vrais (le mélange de deux chunks, plus du bruit),
// rangés dans une table à part, supprimée à la fin.
// Lancement : npm run mesurer:index (après npm run indexer), ou npm run mesurer:index -- --lignes 20000 pour un banc plus petit
import { parseArgs } from "node:util";
import pgvector from "pgvector/pg";
import { chargerFaq } from "../corpus/faq.ts";
import { pool } from "../db.ts";
import { vectoriser } from "../embeddings/fournisseurs.ts";
import { normaliser } from "../embeddings/similarite.ts";
import { parametres } from "../stockage/chunks.ts";

const { values } = parseArgs({ options: { lignes: { type: "string", default: "100000" } } });
const LIGNES = Number(values.lignes);
const K = 10; // on compare les 10 premiers résultats
const secondes = (debut: number) => ((performance.now() - debut) / 1000).toFixed(1);
const mediane = (nombres: number[]) => [...nombres].sort((a, b) => a - b)[nombres.length >> 1];

// Un générateur pseudo-aléatoire à graine (mulberry32) : le même banc d'essai à chaque lancement
function generateur(graine: number) {
  return () => {
    graine = (graine + 0x6d2b79f5) | 0;
    let t = Math.imul(graine ^ (graine >>> 15), 1 | graine);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const client = await pool.connect(); // une seule connexion : les réglages SET restent valables d'une requête à l'autre

// 1. Le banc d'essai, à partir des vecteurs des vrais chunks
const { rows: chunks } = await client.query<{ embedding: number[] }>("SELECT embedding FROM chunks");
if (chunks.length === 0) throw new Error("La table chunks est vide : lancez d'abord npm run indexer");
const dimension = chunks[0].embedding.length;
const hasard = generateur(42);
const fabriquer = () => {
  const a = chunks[Math.floor(hasard() * chunks.length)].embedding;
  const b = chunks[Math.floor(hasard() * chunks.length)].embedding;
  const poids = hasard();
  return normaliser(a.map((x, i) => x + poids * b[i] + (hasard() - 0.5) * 0.1));
};
let debut = performance.now();
await client.query("DROP TABLE IF EXISTS banc");
await client.query(`CREATE TABLE banc (id integer PRIMARY KEY, embedding vector(${dimension}) NOT NULL)`);
for (let premier = 0; premier < LIGNES; premier += 1000) {
  const lot = Array.from({ length: Math.min(1000, LIGNES - premier) }, (_, i) => [premier + i, pgvector.toSql(fabriquer())]);
  await client.query(`INSERT INTO banc (id, embedding) VALUES ${parametres(lot.length, 2)}`, lot.flat());
}
console.log(`Banc d'essai : ${LIGNES.toLocaleString("fr-FR")} vecteurs de ${dimension} dimensions, créés en ${secondes(debut)} s`);

// 2. Les questions : celles de la FAQ, vectorisées comme une vraie requête
const questions = (await vectoriser((await chargerFaq()).map((entree) => entree.question), "requete")).map((v) => pgvector.toSql(v));

// Chaque question, avec son temps de réponse et les identifiants des K résultats
async function chercherTout() {
  const resultats: { ids: number[]; ms: number }[] = [];
  for (const question of questions) {
    const debut = performance.now();
    const { rows } = await client.query<{ id: number }>(`SELECT id FROM banc ORDER BY embedding <=> $1 LIMIT ${K}`, [question]);
    resultats.push({ ids: rows.map((ligne) => ligne.id), ms: performance.now() - debut });
  }
  return resultats;
}

// 3. La référence : la recherche exacte, sans index, qui compare la question à chaque ligne
await chercherTout(); // un premier passage met la table en mémoire
const exacts = await chercherTout();
console.log(`\n${questions.length} questions, ${K} résultats par question`);
console.log(`Recherche exacte, sans index : ${mediane(exacts.map((r) => r.ms)).toFixed(1)} ms par question (médiane)`);

// Le rappel : en moyenne, la part des K vrais plus proches voisins que l'index a retrouvés
async function mesurer(reglage: string, valeurs: number[]) {
  for (const valeur of valeurs) {
    await client.query(`SET ${reglage} = ${valeur}`);
    await chercherTout();
    const approches = await chercherTout();
    const rappel = approches.reduce((somme, r, i) => somme + r.ids.filter((id) => exacts[i].ids.includes(id)).length / K, 0) / questions.length;
    console.log(`  ${reglage} = ${String(valeur).padEnd(4)} rappel ${rappel.toFixed(3)}   ${mediane(approches.map((r) => r.ms)).toFixed(1)} ms`);
  }
}

async function construire(nom: string, sql: string) {
  await client.query("DROP INDEX IF EXISTS banc_index");
  const debut = performance.now();
  await client.query(sql);
  const { rows } = await client.query("SELECT pg_size_pretty(pg_relation_size('banc_index')) AS taille");
  console.log(`\n${nom} : construit en ${secondes(debut)} s, ${rows[0].taille}`);
}

// 4. HNSW : un graphe de voisins. m et ef_construction règlent la construction, ef_search la recherche
// Le graphe tient en mémoire pendant la construction. Si PostgreSQL construit en parallèle, cette mémoire
// est partagée entre processus : c'est pourquoi docker-compose.yml donne 1 Go de mémoire partagée au conteneur
await client.query("SET maintenance_work_mem = '1GB'");
await construire("HNSW (m = 16, ef_construction = 64)", "CREATE INDEX banc_index ON banc USING hnsw (embedding vector_cosine_ops)");
await mesurer("hnsw.ef_search", [10, 20, 40, 100, 200]);

// 5. IVFFlat : des groupes de vecteurs voisins. lists fixe le nombre de groupes, probes le nombre de groupes parcourus
await construire("IVFFlat (lists = 100)", "CREATE INDEX banc_index ON banc USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)");
await mesurer("ivfflat.probes", [1, 5, 10, 20]);

await client.query("DROP TABLE banc");
client.release();
await pool.end();
