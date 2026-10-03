// Les documents produits par l'ingestion du chapitre 4, et les chunks du découpage, relus depuis leur fichier JSON Lines
import { readFile } from "node:fs/promises";
import type { Document } from "../ingestion/document.ts";
import type { Chunk } from "./chunk.ts";

async function lireJsonl<T>(fichier: string, commande: string): Promise<T[]> {
  const contenu = await readFile(fichier, "utf8").catch((erreur) => {
    if (erreur.code === "ENOENT") throw new Error(`${fichier} introuvable : lancez d'abord ${commande}`);
    throw erreur; // une autre erreur de lecture (droits, disque) reste telle quelle
  });
  return contenu.split("\n").filter(Boolean).map((ligne) => JSON.parse(ligne));
}

export const lireDocuments = (fichier = "donnees/documents.jsonl") => lireJsonl<Document>(fichier, "npm run ingest");

export const lireChunks = (fichier = "donnees/chunks.jsonl") => lireJsonl<Chunk>(fichier, "npm run decouper");
