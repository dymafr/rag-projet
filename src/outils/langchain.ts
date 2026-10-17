// Poser une question à Rhéa réécrite avec LangChain.js : les passages trouvés, la réponse, ses sources, ses tokens et sa
// durée. --recherche langchain (par défaut) : le magasin pgvector de LangChain, recherche vectorielle seule, avec les
// filtres d'accès et de date ; --recherche rhea : la recherche du chapitre 9, branchée comme retriever
// Lancement : npm run langchain -- "Combien de jours de télétravail par semaine ?" [--date 2026-01-15] [--recherche rhea]
import { parseArgs } from "node:util";
import { pool } from "../db.ts";
import { creerChaine, creerMagasin, filtreLangChain, lireMessage, modeleLangChain, RetrieverRhea, versResultat, type Entree } from "../frameworks/langchain.ts";
import { numerosCites } from "../generation/citations.ts";
import { PASSAGES_DEMANDES } from "../generation/prompt.ts";
import { lirePromptSysteme } from "../generation/systeme.ts";
import { aujourdhui } from "../recherche/passages.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    date: { type: "string", default: aujourdhui() },
    recherche: { type: "string", default: "langchain" },
  },
});
const question = positionals.join(" ");
if (!question) throw new Error('Posez une question : npm run langchain -- "Combien de jours de télétravail par semaine ?"');
if (!["langchain", "rhea"].includes(values.recherche)) throw new Error("--recherche attend langchain ou rhea");

const k = PASSAGES_DEMANDES; // 8, comme Rhéa
// Le magasin, et la vue qu'il lit, ne servent qu'à la recherche de LangChain : avec --recherche rhea, rien n'est créé
const magasin = values.recherche === "langchain" ? await creerMagasin(pool) : undefined;
const chercher = magasin
  ? (e: Entree) => magasin.asRetriever({ k, filter: filtreLangChain(e.date) }).invoke(e.question)
  : (e: Entree) => new RetrieverRhea(pool, k, e.date).invoke(e.question);
const chaine = creerChaine(chercher, modeleLangChain(), (await lirePromptSysteme()).texte);

try {
  const debut = performance.now();
  const sortie = await chaine.invoke({ question, date: values.date });
  const secondes = ((performance.now() - debut) / 1000).toFixed(1);
  const { texte, usage } = lireMessage(sortie.message);
  const passages = sortie.documents.map(versResultat);
  console.log(`Passages (${values.recherche === "rhea" ? "recherche de Rhéa" : "magasin LangChain"}) :`);
  for (const [i, p] of passages.entries()) console.log(`  [${i + 1}] ${p.id.padEnd(16)} ${p.titres.join(" > ")}`);
  console.log(`\n${texte.trim()}\n`);
  console.log(`Sources citées : ${numerosCites(texte, passages).map((n) => passages[n - 1].id).join(", ") || "aucune"}`);
  console.log(`${usage.entree} tokens en entrée, ${usage.sortie} en sortie, ${secondes} s`);
} finally {
  await pool.end();
}
