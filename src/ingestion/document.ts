// Le modèle commun : quel que soit son format d'origine, chaque source devient un Document
import { createHash } from "node:crypto";
import type { Metadonnees } from "./metadonnees.ts";

export type Document = {
  id: string; // l'identifiant cité dans les réponses : POL-NF-01, TK-2026-0038…
  source: string; // d'où il vient : le fichier, et pour un ticket, sa place dans le fichier
  titre: string;
  texte: string; // en Markdown
  metadonnees: Metadonnees;
};

// Un même texte doit toujours s'écrire avec les mêmes caractères
export function normaliser(texte: string): string {
  return texte
    .normalize("NFC") // « é » : un seul caractère, jamais « e » suivi d'un accent
    .replace(/[\u00a0\u202f]/g, " ") // espaces insécables
    .replace(/\r\n?/g, "\n") // fins de ligne Windows
    .replace(/[ \t]+/g, " ") // espaces et tabulations répétés
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n") // lignes vides répétées
    .trim();
}

// L'empreinte d'un texte : deux documents de même empreinte ont exactement le même texte
export const empreinte = (texte: string) => createHash("sha256").update(texte).digest("hex");

// Garde le premier document de chaque empreinte, et liste les doublons écartés
export function dedoublonner(documents: Document[]) {
  const parEmpreinte = new Map<string, Document>();
  const doublons: { doublon: Document; original: Document }[] = [];
  for (const document of documents) {
    const cle = empreinte(document.texte);
    const original = parEmpreinte.get(cle);
    if (original) doublons.push({ doublon: document, original });
    else parEmpreinte.set(cle, document);
  }
  return { uniques: [...parEmpreinte.values()], doublons };
}
