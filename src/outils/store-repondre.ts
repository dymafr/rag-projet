// Poser une question à Rhéa version RAG géré : le modèle OpenAI de FILE_SEARCH_MODEL cherche dans le vector store avec
// l'outil file_search, puis répond. On affiche ce que l'outil a fait (requêtes, passages), la réponse avec ses
// citations, et ce que la question a consommé
// Lancement : npm run store:repondre -- "Combien de jours de télétravail par semaine ?" [--date 2026-01-15] [--k 8]
//             [--seuil 0.4] [--poids-texte 0.3] (la part des mots dans la recherche hybride, de 0 à 1)
import { parseArgs } from "node:util";
import { config } from "../config.ts";
import { clientOpenAI } from "../gere/client.ts";
import { avecCitations, poidsHybrides, repondreAvecFileSearch } from "../gere/file-search.ts";
import { filtreEnVigueur, lireStore } from "../gere/store.ts";
import { lirePromptSysteme } from "../generation/systeme.ts";
import { aujourdhui } from "../recherche/passages.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    date: { type: "string", default: aujourdhui() },
    k: { type: "string", default: "8" },
    seuil: { type: "string" },
    "poids-texte": { type: "string" },
  },
});
const question = positionals.join(" ");
if (!question) throw new Error('Posez une question : npm run store:repondre -- "Combien de jours de télétravail par semaine ?"');
if (!config.FILE_SEARCH_MODEL) throw new Error("FILE_SEARCH_MODEL manque dans .env : un modèle OpenAI qui accepte l'outil file_search");

const k = Number(values.k);
if (!Number.isInteger(k) || k < 1 || k > 50) throw new Error("--k attend un nombre entier de 1 à 50, par exemple --k 8");
const seuil = values.seuil === undefined ? undefined : Number(values.seuil);
if (seuil !== undefined && !(seuil >= 0 && seuil <= 1)) throw new Error("--seuil attend un nombre de 0 à 1, par exemple --seuil 0.5");
const poidsTexte = values["poids-texte"] === undefined ? undefined : Number(values["poids-texte"]);
if (poidsTexte !== undefined && !(poidsTexte >= 0 && poidsTexte <= 1)) throw new Error("--poids-texte attend un nombre de 0 à 1, par exemple 0.3");
const systeme = await lirePromptSysteme("prompts/rhea-file-search.md");
const debut = performance.now();
const r = await repondreAvecFileSearch(
  clientOpenAI(),
  config.FILE_SEARCH_MODEL,
  { systeme: systeme.texte, question, date: values.date, store: (await lireStore()).id, filtres: filtreEnVigueur(values.date) },
  {
    k, // 8 par défaut : autant de passages que Rhéa en demande (chapitre 7)
    ...(seuil !== undefined && { seuil }),
    ...(poidsTexte !== undefined && { hybride: poidsHybrides(poidsTexte) }),
  },
);
const secondes = ((performance.now() - debut) / 1000).toFixed(1);

console.log(`Requête(s) lancée(s) par le modèle : ${r.requetes.map((q) => `« ${q} »`).join(", ") || "aucune"}`);
console.log(`Passages lus : ${r.passages.length}`);
for (const p of r.passages) console.log(`  ${p.score.toFixed(3)}  ${p.document.padEnd(20)} ${p.texte.replace(/\s+/g, " ").slice(0, 80)}…`);
console.log(`\n${avecCitations(r.texte, r.citations)}\n`);
const brutes = r.marqueurs ? ` (dont ${r.marqueurs} lue(s) dans des marqueurs bruts du texte)` : "";
console.log(`Sources citées : ${[...new Set(r.citations.map((c) => c.document))].join(", ") || "aucune"}${brutes}`);
console.log(`${r.recherches} appel(s) de file_search, ${r.usage.entree} tokens en entrée (dont ${r.usage.enCache} en cache), ${r.usage.sortie} en sortie, ${secondes} s`);
