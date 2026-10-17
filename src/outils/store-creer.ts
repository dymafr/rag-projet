// Confier la documentation de Kalyo au RAG géré d'OpenAI : créer un vector store, y téléverser le texte de chaque
// document ouvert à tous (donnees/textes, écrit par npm run textes au chapitre 10) avec ses attributs, puis attendre que
// chaque fichier soit découpé et vectorisé. Le store et ses fichiers restent chez OpenAI jusqu'à leur suppression
// (npm run store:supprimer) ; un store inactif pendant JOURS_INACTIF jours expire de lui-même
// Lancement : npm run store:creer -- [--taille 800 --chevauchement 400] (sans option : le découpage auto d'OpenAI)
import { createReadStream } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DOSSIER_TEXTES } from "../agent/fichiers.ts";
import { lireDocuments } from "../decoupage/corpus.ts";
import { clientOpenAI } from "../gere/client.ts";
import { attributsDe, ecrireStore, FICHIER_STORE, type Store } from "../gere/store.ts";
import { aujourdhui } from "../recherche/passages.ts";
import { dateDeFin } from "../stockage/chunks.ts";

const JOURS_INACTIF = 7;

const { values } = parseArgs({ options: { taille: { type: "string" }, chevauchement: { type: "string" } } });
const taille = values.taille === undefined ? undefined : Number(values.taille);
const chevauchement = Number(values.chevauchement ?? 0);
if (values.chevauchement !== undefined && taille === undefined) throw new Error("--chevauchement demande aussi --taille, par exemple --taille 800 --chevauchement 400");
if (taille !== undefined && !(Number.isInteger(taille) && taille > 0 && Number.isInteger(chevauchement) && chevauchement >= 0)) {
  throw new Error("--taille et --chevauchement attendent des nombres entiers, par exemple --taille 800 --chevauchement 400");
}
// Le découpage se choisit en rattachant le fichier : pour en changer, il faut recréer le store (ou rattacher à nouveau)
const decoupage = taille
  ? { type: "static" as const, static: { max_chunk_size_tokens: taille, chunk_overlap_tokens: chevauchement } }
  : undefined;

const client = clientOpenAI();
const documents = await lireDocuments();
const parId = new Map(documents.map((d) => [d.id, d]));
const ouverts = documents.filter((d) => d.metadonnees.acces === "tous"); // comme Rhéa : ni managers, ni RH, ni tickets

const vs = await client.vectorStores.create({ name: "rhea-kalyo", expires_after: { anchor: "last_active_at", days: JOURS_INACTIF } });
console.log(`Vector store ${vs.id} créé`);
const store: Store = { id: vs.id, nom: vs.name, date: aujourdhui(), fichiers: {} };
// Les identifiants sont écrits tout de suite, puis après chaque téléversement : si une étape échoue, npm run
// store:supprimer sait encore quoi supprimer chez OpenAI
await ecrireStore(store);
let echecs = 0;
let octets = 0;
for (const d of ouverts) {
  // 1. Le fichier, téléversé chez OpenAI ; 2. son rattachement au store, avec ses attributs ; createAndPoll attend la fin
  // de l'indexation, et rend la main même en cas d'échec : il faut lire le statut
  const fichier = await client.files.create({ file: createReadStream(join(DOSSIER_TEXTES, `${d.id}.md`)), purpose: "assistants" });
  store.fichiers[d.id] = fichier.id;
  await ecrireStore(store);
  const rattache = await client.vectorStores.files.createAndPoll(vs.id, {
    file_id: fichier.id,
    attributes: attributsDe(d, dateDeFin(d, parId)),
    ...(decoupage && { chunking_strategy: decoupage }),
  });
  octets += rattache.usage_bytes;
  if (rattache.status !== "completed") echecs++;
  const erreur = rattache.last_error ? ` (${rattache.last_error.code} : ${rattache.last_error.message})` : "";
  console.log(`${d.id.padEnd(20)} ${rattache.status}${erreur}`);
}
console.log(`\n${ouverts.length - echecs} fichiers indexés sur ${ouverts.length}, ${(octets / 1024).toFixed(0)} Kio dans le store`);
console.log(`Découpage : ${decoupage ? `${values.taille} tokens, chevauchement ${values.chevauchement ?? 0}` : "auto"} ; expiration après ${JOURS_INACTIF} jours sans usage`);
console.log(`Identifiants enregistrés dans ${FICHIER_STORE}`);
