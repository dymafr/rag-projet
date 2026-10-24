// Contextualiser un chunk : lui rendre ce que le découpage lui a fait perdre, avant de le vectoriser
import { readFile, rename, writeFile } from "node:fs/promises";
import { empreinte, type Document } from "../ingestion/document.ts";
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

// 4. Chapitre 14 : tout le corpus, pour la production (npm run decouper avec CONTEXTUALISER=oui). Les contextes se
// gardent dans un fichier, par empreinte du document et du chunk : à la réindexation suivante, seul un chunk nouveau, ou
// d'un document modifié, coûte un appel au LLM. PARALLELES documents à la fois ; dans un document, l'un après l'autre
export const CONTEXTES = "donnees/contextes.json";
const PARALLELES = 6;

export async function contextualiserLeCorpus(documents: Document[], chunks: Chunk[], llm: Llm, fichier = CONTEXTES) {
  let gardes: Record<string, string> = {};
  try {
    gardes = JSON.parse(await readFile(fichier, "utf8")) as Record<string, string>;
  } catch (erreur) {
    if ((erreur as NodeJS.ErrnoException).code !== "ENOENT") throw erreur;
  }
  const cle = (document: Document, chunk: Chunk) => empreinte(`${document.texte}\n${chunk.texte}`);
  // Chaque document fait s'écrit aussitôt : une erreur au milieu (une limite de débit, une coupure) ne perd que les
  // contextes du document qui échoue, et la commande relancée reprend où elle s'était arrêtée. Une écriture après
  // l'autre, dans un fichier voisin renommé ensuite : jamais un fichier à moitié écrit
  let ecriture = Promise.resolve();
  const sauver = (contenu: Record<string, string>) =>
    (ecriture = ecriture.then(async () => {
      await writeFile(`${fichier}.tmp`, `${JSON.stringify(contenu, null, 1)}\n`);
      await rename(`${fichier}.tmp`, fichier);
    }));
  const usage: Usage = { entree: 0, enCache: 0, sortie: 0 };
  let appels = 0;
  let echec = false; // après une erreur, aucun travailleur ne commence un autre document
  const aFaire = [...documents];
  const travailleur = async () => {
    for (let document = aFaire.shift(); document && !echec; document = aFaire.shift()) {
      const d = document;
      const manquants = chunks.filter((c) => c.document === d.id && !gardes[cle(d, c)]);
      if (manquants.length === 0) continue;
      const fait = await contextualiser(d, manquants, llm).catch((erreur: unknown) => {
        echec = true;
        throw erreur;
      });
      for (const c of fait.chunks) gardes[cle(d, c)] = c.contexte!;
      appels += manquants.length;
      usage.entree += fait.usage.entree;
      usage.enCache += fait.usage.enCache;
      usage.sortie += fait.usage.sortie;
      await sauver(gardes);
    }
  };
  // Tous les travailleurs finissent le document en cours (et l'écrivent) avant que l'erreur remonte
  const fins = await Promise.allSettled(Array.from({ length: PARALLELES }, travailleur));
  const rate = fins.find((f): f is PromiseRejectedResult => f.status === "rejected");
  if (rate) throw rate.reason;
  const parId = new Map(documents.map((d) => [d.id, d]));
  const resultat = chunks.map((c) => ({ ...c, contexte: gardes[cle(parId.get(c.document)!, c)] }));
  // On ne garde que les contextes encore utilisés : ceux d'un chunk disparu partent avec lui
  const utilises = Object.fromEntries(resultat.map((c) => [cle(parId.get(c.document)!, c), c.contexte!]));
  await sauver(utilises);
  return { chunks: resultat, appels, usage };
}
