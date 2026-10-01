// Contextualiser un chunk : lui rendre ce que le découpage lui a fait perdre, avant de le vectoriser
import type { Document } from "../ingestion/document.ts";
import type { Llm, Usage } from "../llm.ts";
import type { Chunk } from "./chunk.ts";

// 1. Le texte qu'on vectorise : le chemin de titres (où se trouve le chunk), le contexte s'il y en a un, puis le chunk
export function texteAVectoriser(chunk: Chunk): string {
  return [chunk.titres.join(" > "), chunk.contexte, chunk.texte].filter(Boolean).join("\n\n");
}

// 2. Le prompt qui demande au LLM de situer le chunk dans son document (d'après la méthode « Contextual Retrieval »
// d'Anthropic). Il commence par le document entier, identique pour tous ses chunks : c'est la partie mise en cache
export function promptDeContexte(document: Document, chunk: Chunk) {
  const debut = `<document>\n${document.texte}\n</document>`;
  const fin = [
    "Voici un passage de ce document :",
    `<chunk>\n${chunk.texte}\n</chunk>`,
    "Rédige une ou deux phrases courtes qui situent ce passage dans le document, pour aider à le retrouver lors d'une recherche.",
    "Réponds seulement par ces phrases, en français.",
  ].join("\n");
  return { debut, fin };
}

// 3. Un appel par chunk, l'un après l'autre : le premier met le document en cache, les suivants le relisent
export async function contextualiser(document: Document, chunks: Chunk[], llm: Llm) {
  const usage: Usage = { entree: 0, enCache: 0, sortie: 0 };
  const resultat: Chunk[] = [];
  for (const chunk of chunks) {
    const { debut, fin } = promptDeContexte(document, chunk);
    const reponse = await llm(debut, fin);
    resultat.push({ ...chunk, contexte: reponse.texte.trim() });
    usage.entree += reponse.usage.entree;
    usage.enCache += reponse.usage.enCache;
    usage.sortie += reponse.usage.sortie;
  }
  return { chunks: resultat, usage };
}
