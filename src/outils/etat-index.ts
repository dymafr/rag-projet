// L'état de l'index (chapitre 14, leçon 9) : est-il à jour avec le corpus, avec le bon modèle, et en bonne santé ? Sans rien
// modifier : on compare, on compte, on conseille. --planifier inscrit une réindexation dans la file (leçon 1) si l'index
// est en retard ; le travailleur la fera.
// Lancement : npm run index:etat -- [--planifier]
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { lireChunks, lireDocuments } from "../decoupage/corpus.ts";
import { pool } from "../db.ts";
import { nomDuModele } from "../embeddings/fournisseurs.ts";
import { plancherMesure, plancherPour } from "../generation/abstention.ts";
import { aujourdhui } from "../recherche/passages.ts";
import { dateDeFin, empreintes } from "../stockage/chunks.ts";
import { planifier, type Empreintes } from "../stockage/incremental.ts";
import { lireIndexation } from "../stockage/schema.ts";
import { ajouter, creerFile } from "../taches/file.ts";

const { values } = parseArgs({ options: { planifier: { type: "boolean", default: false } } });
const conseils: string[] = [];

// 1. Le corpus a-t-il changé depuis la dernière ingestion ? Les fichiers plus récents que donnees/documents.jsonl
async function fichiers(dossier: string): Promise<string[]> {
  const entrees = await readdir(dossier, { withFileTypes: true });
  return (await Promise.all(entrees.map((e) => (e.isDirectory() ? fichiers(join(dossier, e.name)) : [join(dossier, e.name)])))).flat();
}
const dateDe = async (fichier: string) => (await stat(fichier).catch(() => null))?.mtimeMs ?? 0;
const ingestion = await dateDe("donnees/documents.jsonl");
const decoupage = await dateDe("donnees/chunks.jsonl");
const modifies = [];
for (const f of await fichiers("corpus")) if ((await dateDe(f)) > ingestion) modifies.push(f);
console.log(`Corpus : ${modifies.length ? `${modifies.length} fichier(s) modifié(s) depuis la dernière ingestion` : "rien de modifié depuis la dernière ingestion"}`);
for (const f of modifies.slice(0, 10)) console.log(`  ${f}`);
if (modifies.length) conseils.push("réingérer et réindexer le corpus (npm run tache -- reindexer)");
if (decoupage < ingestion) conseils.push("redécouper : donnees/chunks.jsonl est plus ancien que documents.jsonl");

// 2. La base contient-elle ce que le découpage a produit ? Le plan de l'indexation incrémentale, sans rien écrire
const documents = new Map((await lireDocuments()).map((d) => [d.id, d]));
const chunks = await lireChunks();
// Un passage dont le document a quitté documents.jsonl (une ingestion relancée seule) : le découpage est en retard
const orphelins = chunks.filter((chunk) => !documents.has(chunk.document));
if (orphelins.length) conseils.push(`redécouper : ${orphelins.length} passage(s) de donnees/chunks.jsonl viennent de documents qui ne sont plus ingérés`);
const voulus = chunks
  .filter((chunk) => documents.has(chunk.document))
  .map((chunk) => {
    const document = documents.get(chunk.document)!;
    return { id: chunk.id, ...empreintes(chunk, document, dateDeFin(document, documents)) };
  });
const { rows: enBase } = await pool.query<Empreintes>("SELECT id, empreinte, empreinte_meta FROM chunks");
const plan = planifier(voulus, enBase);
const retard = plan.aVectoriser.length + plan.aMettreAJour.length + plan.aSupprimer.length;
console.log(`Index : ${enBase.length} passages ; ${retard ? `en retard (${plan.aVectoriser.length} à vectoriser, ${plan.aMettreAJour.length} à mettre à jour, ${plan.aSupprimer.length} à supprimer)` : "à jour avec le découpage"}`);
if (retard) conseils.push("réindexer : l'index ne contient pas ce que le découpage a produit");

// 3. Le modèle : celui de l'index, celui de la configuration, et le plancher d'abstention que l'agent applique (leçon 4),
// mesuré ou non pour ce modèle
const indexation = await lireIndexation(pool);
const modele = nomDuModele();
const plancher = plancherMesure(modele) ? `plancher d'abstention ${plancherPour(modele).toFixed(2).replace(".", ",")}` : "plancher d'abstention non mesuré";
console.log(`Modèle : index ${indexation?.modele ?? "inconnu"} (${indexation?.stockage ?? "?"}, ${indexation?.dimension ?? "?"} dimensions), configuration ${modele}, ${plancher}`);
if (indexation && indexation.modele !== modele) conseils.push(`reconstruire l'index avec ${modele} (npm run indexer -- --reconstruire), puis redémarrer le serveur`);
if (!plancherMesure(modele)) conseils.push("mesurer le plancher d'abstention de ce modèle sur le jeu de travail (leçon 4) : la plage des similarités dépend du modèle d'embedding");

// 4. Les dates : des textes remplacés (gardés pour les questions sur le passé) et des textes pas encore en vigueur
const jour = aujourdhui();
const { rows: dates } = await pool.query<{ remplaces: number; futurs: number }>(
  "SELECT count(DISTINCT document) FILTER (WHERE date_fin <= $1)::int AS remplaces, count(DISTINCT document) FILTER (WHERE date_effet > $1)::int AS futurs FROM chunks",
  [jour],
);
console.log(`Dates : ${dates[0].remplaces} document(s) remplacé(s), gardé(s) pour le passé ; ${dates[0].futurs} pas encore en vigueur le ${jour}`);

// 5. La santé de la table : des lignes mortes (supprimées ou remplacées, pas encore récupérées) ralentissent la recherche
const { rows: sante } = await pool.query<{ mortes: number; index: boolean }>(
  // Un index valide seulement : un CREATE INDEX CONCURRENTLY interrompu laisse un index INVALID, que la recherche ignore
  `SELECT n_dead_tup::int AS mortes,
     EXISTS (SELECT 1 FROM pg_indexes i JOIN pg_index x ON x.indexrelid = format('%I.%I', i.schemaname, i.indexname)::regclass
             WHERE i.tablename = 'chunks' AND i.indexdef LIKE '%hnsw%' AND x.indisvalid) AS index
   FROM pg_stat_user_tables WHERE relname = 'chunks'`,
);
const s = sante[0];
// (les statistiques de PostgreSQL : un compteur que chaque UPDATE et DELETE fait monter, que VACUUM fait redescendre,
// et qu'un arrêt brutal du serveur remet à zéro)
console.log(`Table : ${s?.mortes ?? "?"} ligne(s) morte(s) selon les statistiques de PostgreSQL ; index HNSW ${s?.index ? "présent" : "ABSENT ou invalide"}`);
if (s && s.mortes > 0.2 * Math.max(enBase.length, 1)) conseils.push("VACUUM ANALYZE chunks : plus d'une ligne sur cinq est morte");
if (s && !s.index) conseils.push("recréer l'index HNSW : sans lui, chaque recherche compare la question à tous les passages");

console.log(conseils.length ? `\nÀ faire :\n  - ${conseils.join("\n  - ")}` : "\nRien à faire : l'index est à jour.");
// La tâche reindexer refait tout le chemin (ingérer, découper, indexer) : elle sert aussi quand seul le découpage est en retard
if (values.planifier && (modifies.length || retard || decoupage < ingestion || orphelins.length)) {
  await creerFile(pool);
  console.log(`Réindexation inscrite dans la file : tâche ${await ajouter(pool, "reindexer")}`);
}
await pool.end();
