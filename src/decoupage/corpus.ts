// Les documents produits par l'ingestion du chapitre 4, relus depuis leur fichier JSON Lines
import { readFile } from "node:fs/promises";
import type { Document } from "../ingestion/document.ts";

export async function lireDocuments(fichier = "donnees/documents.jsonl"): Promise<Document[]> {
  const contenu = await readFile(fichier, "utf8").catch((erreur) => {
    if (erreur.code === "ENOENT") throw new Error(`${fichier} introuvable : lancez d'abord npm run ingest`);
    throw erreur; // une autre erreur de lecture (droits, disque) reste telle quelle
  });
  return contenu.split("\n").filter(Boolean).map((ligne) => JSON.parse(ligne));
}
