// Indexer les chunks du chapitre 5 dans PostgreSQL, sans refaire ce qui est déjà fait : seuls les chunks nouveaux
// ou modifiés sont vectorisés, et ceux qui ont disparu sont supprimés.
// Lancement : npm run indexer (la base doit tourner : npm run db:up)
//             npm run indexer -- --reconstruire (tout revectoriser, par exemple après un changement de modèle)
//             options : -- --halfvec (vecteurs en demi-précision), -- --lot 1 (une requête par ligne)
import { parseArgs } from "node:util";
import { texteAVectoriser } from "../decoupage/contexte.ts";
import { lireChunks, lireDocuments } from "../decoupage/corpus.ts";
import { pool } from "../db.ts";
import { nomDuModele, vectoriser } from "../embeddings/fournisseurs.ts";
import { dateDeFin, empreintes, insererParLots, ligne, metadonnees } from "../stockage/chunks.ts";
import { mettreAJour, planifier, supprimer, type Empreintes } from "../stockage/incremental.ts";
import { basculer, creerIndex, creerTable, ecrireIndexation, lireIndexation } from "../stockage/schema.ts";

const { values } = parseArgs({
  options: {
    lot: { type: "string", default: "100" }, // lignes par requête INSERT
    halfvec: { type: "boolean", default: false }, // vecteurs en demi-précision : 2 octets par dimension au lieu de 4
    reconstruire: { type: "boolean", default: false }, // tout revectoriser, dans une nouvelle table
  },
});
const secondes = (debut: number) => ((performance.now() - debut) / 1000).toFixed(1);

// Arrête le script avec un message, sans rien changer dans la base
async function arreter(...lignes: string[]): Promise<never> {
  console.error(lignes.join("\n"));
  await pool.end();
  process.exit(1);
}

const lot = Number(values.lot);
if (!Number.isInteger(lot) || lot < 1) await arreter(`--lot attend un nombre entier positif, pas « ${values.lot} »`);

const documents = new Map((await lireDocuments()).map((document) => [document.id, document]));
const chunks = await lireChunks();
if (chunks.length === 0) await arreter("donnees/chunks.jsonl ne contient aucun chunk : relancez npm run decouper");
const documentDe = (id: string) => {
  const document = documents.get(id);
  if (!document) throw new Error(`Document ${id} absent de documents.jsonl : relancez npm run decouper`);
  return document;
};

// 1. Le modèle : des vecteurs calculés par deux modèles différents ne se comparent pas
const modele = nomDuModele();
const stockage = values.halfvec ? "halfvec" : "vector";
const indexation = await lireIndexation(pool);
if (indexation && !values.reconstruire) {
  if (indexation.modele !== modele) {
    await arreter(
      `La base a été indexée avec ${indexation.modele}, le projet est réglé sur ${modele}.`,
      "Les vecteurs de deux modèles ne se comparent pas : relancez npm run indexer -- --reconstruire pour tout revectoriser.",
    );
  }
  if (indexation.stockage !== stockage) {
    await arreter(`La base range ses vecteurs en ${indexation.stockage}, cette exécution en ${stockage} : relancez avec les mêmes options, ou ajoutez --reconstruire pour changer de stockage.`);
  }
}
// Première indexation, table chunks effacée, ou reconstruction demandée : tout va dans une nouvelle table,
// qui remplacera l'ancienne à la fin
const { rows: tables } = await pool.query<{ nom: string | null }>("SELECT to_regclass('chunks')::text AS nom");
const reconstruire = indexation === null || tables[0].nom === null || values.reconstruire;
const table = reconstruire ? "chunks_nouveau" : "chunks";

// 2. Ce que la base doit contenir, et ce qu'elle contient déjà
const voulus = chunks.map((chunk) => {
  const document = documentDe(chunk.document);
  const dateFin = dateDeFin(document, documents);
  return { id: chunk.id, chunk, document, dateFin, ...empreintes(chunk, document, dateFin) };
});
const enBase = reconstruire ? [] : (await pool.query<Empreintes>("SELECT id, empreinte, empreinte_meta FROM chunks")).rows;
const plan = planifier(voulus, enBase);
console.log(`${voulus.length} chunks : ${plan.aVectoriser.length} à vectoriser, ${plan.aMettreAJour.length} à mettre à jour, ` +
  `${plan.aSupprimer.length} à supprimer, ${plan.inchanges} inchangés`);

// 3. Vectoriser seulement ce qui doit l'être (en reconstruction, tout : le premier vecteur donne la dimension)
let debut = performance.now();
const vecteurs = await vectoriser(plan.aVectoriser.map((voulu) => texteAVectoriser(voulu.chunk)), "document");
if (vecteurs.length > 0) console.log(`Vectorisation : ${vecteurs.length} chunk${vecteurs.length > 1 ? "s" : ""} en ${secondes(debut)} s`);
const dimension = vecteurs[0]?.length ?? indexation!.dimension;

// 4. Tout écrire dans une transaction, sur une seule connexion : si une étape échoue, rien n'est changé (ROLLBACK)
const client = await pool.connect();
debut = performance.now();
try {
  await client.query("BEGIN");
  if (reconstruire) await creerTable(client, dimension, stockage, table);
  await insererParLots(client, plan.aVectoriser.map((voulu, i) => ligne(voulu.chunk, voulu.document, vecteurs[i], voulu.dateFin)), lot, table);
  for (const voulu of plan.aMettreAJour) {
    await mettreAJour(client, voulu.id, metadonnees(voulu.document, voulu.dateFin), voulu.empreinte_meta, table);
  }
  await supprimer(client, plan.aSupprimer, table);
  if (reconstruire) {
    await creerIndex(client, stockage, table); // l'index, une fois la table remplie
    await basculer(client);
    await ecrireIndexation(client, { modele, dimension, stockage });
  }
  await client.query("COMMIT");
} catch (erreur) {
  await client.query("ROLLBACK").catch(() => {}); // c'est la première erreur qui explique l'échec
  throw erreur;
} finally {
  client.release();
}
console.log(`Base à jour en ${secondes(debut)} s${reconstruire ? ` : table chunks reconstruite avec ${modele}, ${stockage}(${dimension})` : ""}`);
await pool.end();
