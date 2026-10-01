// Contextualiser les chunks d'un document avec le LLM de .env, et mesurer ce que ça coûte en tokens
// Lancement : npm run contextualiser -- POL-NF-01
import { config } from "../config.ts";
import { contextualiser, texteAVectoriser } from "../decoupage/contexte.ts";
import { lireDocuments } from "../decoupage/corpus.ts";
import { mesureDuModele } from "../decoupage/mesure.ts";
import { decouperDocument } from "../decoupage/structure.ts";
import { creerLlm } from "../llm.ts";

const TAILLE = 300; // tokens par chunk, comme pour npm run decouper
const { mesure } = await mesureDuModele(config);
const documents = await lireDocuments();
const id = process.argv[2] ?? "POL-NF-01";
const document = documents.find((d) => d.id === id);
if (!document) throw new Error(`Document inconnu : ${id}`);

// 1. Les chunks du document, chacun avec le contexte rédigé par le LLM
const debut = performance.now();
const { chunks, usage } = await contextualiser(document, decouperDocument(document, TAILLE, mesure), creerLlm());
const duree = (performance.now() - debut) / 1000;
console.log(`${document.id} : ${chunks.length} chunks contextualisés par ${config.LLM_PROVIDER} en ${duree.toFixed(0)} s\n`);
for (const chunk of chunks) console.log(`${chunk.id}  ${chunk.contexte}`);

// 2. Un exemple complet de ce qui sera vectorisé : le chemin de titres, le contexte, puis le chunk
const exemple = chunks.find((chunk) => chunk.texte.includes("| ---")) ?? chunks[0];
console.log(`\nTexte à vectoriser pour ${exemple.id} :\n${texteAVectoriser(exemple)}`);

// 3. Ce qu'a coûté ce document, et ce que coûterait tout le corpus : chaque appel renvoie le document entier au LLM
console.log(`\nTokens envoyés au LLM : ${usage.entree} en entrée, dont ${usage.enCache} relus dans le cache ; ${usage.sortie} en sortie`);
let appels = 0;
let entree = 0;
let unParDocument = 0;
for (const d of documents) {
  const n = decouperDocument(d, TAILLE, mesure).length;
  appels += n;
  entree += n * mesure(d.texte);
  unParDocument += mesure(d.texte);
}
console.log(`Tout le corpus : ${appels} appels, environ ${entree} tokens de documents en entrée.`);
console.log(`Avec le cache, chaque document n'est écrit qu'une fois (${unParDocument} tokens) ; les ${entree - unParDocument} autres sont relus, à prix réduit, si le document dépasse la taille minimale de cache du modèle.`);
