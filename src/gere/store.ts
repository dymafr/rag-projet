// Le RAG géré d'OpenAI (chapitre 11) : un vector store garde les documents de Kalyo, les découpe, les vectorise et les
// cherche à notre place. Ce fichier prépare ce qu'on lui confie (les attributs de chaque fichier, les filtres) et retient
// où il se trouve ; les outils src/outils/store-*.ts l'appellent
import { readFile, writeFile } from "node:fs/promises";
import type { ComparisonFilter, CompoundFilter } from "openai/resources/shared";
import type { Document } from "../ingestion/document.ts";

export const FICHIER_STORE = "donnees/store-openai.json"; // écrit par npm run store:creer, lu par les autres outils

// Ce qu'on garde du store créé : son identifiant (vs_…) et, pour chaque document, l'identifiant de son fichier chez OpenAI
export type Store = { id: string; nom: string; date: string; fichiers: Record<string, string> };

export async function lireStore(): Promise<Store> {
  try {
    return JSON.parse(await readFile(FICHIER_STORE, "utf8")) as Store;
  } catch {
    throw new Error(`${FICHIER_STORE} introuvable : créez d'abord le vector store avec npm run store:creer`);
  }
}

export const ecrireStore = (store: Store) => writeFile(FICHIER_STORE, `${JSON.stringify(store, null, 2)}\n`);

// Un attribut vaut une chaîne, un nombre ou un booléen : il n'existe pas de type date. Une date devient donc un
// horodatage Unix, en secondes, que les filtres savent comparer (lte, gt…)
export const horodatage = (date: string) => Date.parse(`${date}T00:00:00Z`) / 1000;
// Un filtre ne sait pas tester l'absence d'un attribut : un document toujours en vigueur reçoit une fin très lointaine
export const SANS_FIN = horodatage("9999-12-31");

export type Attributs = Record<string, string | number | boolean>;

// Les attributs d'un fichier : les métadonnées du document (chapitre 4) qui serviront à filtrer. dateFin : la date d'effet
// du texte qui le remplace, calculée comme pour la base (dateDeFin, src/stockage/chunks.ts)
export function attributsDe(document: Document, dateFin: string | null): Attributs {
  return {
    document: document.id,
    type: document.metadonnees.type,
    debut: horodatage(document.metadonnees.date_effet),
    fin: dateFin ? horodatage(dateFin) : SANS_FIN,
  };
}

export type Filtre = ComparisonFilter | CompoundFilter;

// Les textes en vigueur ce jour-là, comme le filtre enVigueurLe de la base (src/recherche/vectorielle.ts) : le texte
// s'applique déjà (debut <= date) et aucun texte plus récent ne l'a encore remplacé (fin > date). types : en plus,
// seulement ces types de documents (politique, accord…)
export function filtreEnVigueur(date: string, types: string[] = []): Filtre {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Date attendue au format AAAA-MM-JJ, reçu : ${date}`);
  const jour = horodatage(date);
  const filtres: ComparisonFilter[] = [
    { key: "debut", type: "lte", value: jour },
    { key: "fin", type: "gt", value: jour },
  ];
  if (types.length > 0) filtres.push({ key: "type", type: "in", value: types });
  return { type: "and", filters: filtres };
}
