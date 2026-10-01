// Comparer trois façons de chercher dans les politiques et les accords : les chunks du découpage structurel,
// les petits enfants qui rendent leur section, les phrases qui rendent leur fenêtre
// Lancement : npm run comparer -- "Quel est le plafond pour un repas avec un client à Lyon ?"
import { config } from "../config.ts";
import { texteAVectoriser } from "../decoupage/contexte.ts";
import { lireDocuments } from "../decoupage/corpus.ts";
import { mesureDuModele } from "../decoupage/mesure.ts";
import { parentsEtEnfants, phrasesEtFenetres, type Recherchable } from "../decoupage/parents.ts";
import { decouperDocument } from "../decoupage/structure.ts";
import { vectoriser } from "../embeddings/fournisseurs.ts";
import { indexer, topK } from "../recherche/memoire.ts";

const question = process.argv[2] ?? "Quel est le plafond pour un repas avec un client à Lyon ?";
const K = 3; // morceaux retrouvés ; deux enfants d'une même section ne rendent qu'un passage
const { mesure } = await mesureDuModele(config);
const documents = (await lireDocuments()).filter((d) => d.metadonnees.type === "politique" || d.metadonnees.type === "accord");

const strategies: [string, Recherchable[]][] = [
  ["Chunks de 300 tokens", documents.flatMap((d) => decouperDocument(d, 300, mesure).map((chunk) => ({ ...chunk, rendu: chunk.texte })))],
  ["Enfants de 100 tokens, qui rendent leur section", documents.flatMap((d) => parentsEtEnfants(d, 100, mesure))],
  ["Phrases, qui rendent 2 phrases de chaque côté", documents.flatMap((d) => phrasesEtFenetres(d, 2, mesure))],
];

// Le même cache de vecteurs que npm run chercher : un fichier par modèle
const modele = [config.EMBEDDING_PROVIDER, config.EMBEDDING_MODEL, config.EMBEDDING_DIMENSIONS].filter(Boolean).join("-");
const fichierCache = `.cache/embeddings/${modele.replace(/[^\w.-]+/g, "_")}.json`;
const [vQuestion] = await vectoriser([question], "requete");
const apercu = (texte: string) => texte.replace(/\n+/g, " ↵ ").slice(0, 70);

console.log(`« ${question} »  (${documents.length} politiques et accords)`);
for (const [nom, morceaux] of strategies) {
  const debut = performance.now();
  const index = await indexer(morceaux.map((m) => ({ id: m.id, texte: texteAVectoriser(m) })), vectoriser, fichierCache);
  const duree = ((performance.now() - debut) / 1000).toFixed(1);
  const parId = new Map(morceaux.map((m) => [m.id, m]));
  const trouves = topK(vQuestion, index, K).map((r) => ({ ...parId.get(r.id)!, score: r.score }));
  // Deux enfants de la même section rendent le même parent : on ne l'envoie qu'une fois
  const rendus = [...new Set(trouves.map((t) => t.rendu))];
  console.log(`\n${nom} : ${morceaux.length} morceaux vectorisés (${duree} s)`);
  for (const t of trouves) console.log(`  ${t.score.toFixed(3)}  ${t.id.padEnd(15)} ${t.taille} tokens  « ${apercu(t.texte)}… »`);
  console.log(`  Rendu au LLM : ${rendus.length} passages, ${rendus.reduce((somme, r) => somme + mesure(r), 0)} tokens`);
  console.log(`  Le premier : « ${apercu(trouves[0].rendu)}… »`);
}
