// Chercher dans le vector store sans rien générer : les passages qu'OpenAI trouve pour une question, avec leur score et
// les attributs de leur fichier. C'est la recherche seule, celle qu'on évalue (chapitre 8)
// Lancement : npm run store:chercher -- "Combien de jours de télétravail par semaine ?" [--date 2026-01-15]
//             [--type politique,accord] [--k 8] [--seuil 0.4] [--sans-filtre] [--reecrire] [--sans-reclassement]
import { parseArgs } from "node:util";
import { clientOpenAI } from "../gere/client.ts";
import { filtreEnVigueur, lireStore, SANS_FIN } from "../gere/store.ts";
import { aujourdhui } from "../recherche/passages.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    date: { type: "string", default: aujourdhui() },
    type: { type: "string" },
    k: { type: "string", default: "8" },
    seuil: { type: "string" },
    "sans-filtre": { type: "boolean", default: false },
    reecrire: { type: "boolean", default: false },
    "sans-reclassement": { type: "boolean", default: false },
  },
});
const question = positionals.join(" ");
if (!question) throw new Error('Posez une question : npm run store:chercher -- "Combien de jours de télétravail par semaine ?"');

const k = Number(values.k);
if (!Number.isInteger(k) || k < 1 || k > 50) throw new Error("--k attend un nombre entier de 1 à 50, par exemple --k 8");
const seuil = values.seuil === undefined ? undefined : Number(values.seuil);
if (seuil !== undefined && !(seuil >= 0 && seuil <= 1)) throw new Error("--seuil attend un nombre de 0 à 1, par exemple --seuil 0.5");
const client = clientOpenAI();
const store = await lireStore();
const types = values.type ? values.type.split(",") : [];
const page = await client.vectorStores.search(store.id, {
  query: question,
  max_num_results: k, // de 1 à 50 ; sans ce champ, le service applique sa propre valeur par défaut
  // Sans filtre, toutes les versions d'un texte peuvent revenir, celles remplacées comprises
  ...(!values["sans-filtre"] && { filters: filtreEnVigueur(values.date, types) }),
  ranking_options: {
    ranker: values["sans-reclassement"] ? "none" : "auto", // none : pas de reclassement, une réponse plus rapide
    ...(seuil !== undefined && { score_threshold: seuil }), // de 0 à 1 : les passages sous ce score sont écartés
  },
  rewrite_query: values.reecrire, // le service reformule la question avant de chercher
});

// Les horodatages relus en dates ; « … » : pas de date d'effet, ou toujours en vigueur
const date = (s: unknown) => (typeof s === "number" && s > 0 && s < SANS_FIN ? new Date(s * 1000).toISOString().slice(0, 10) : "…");
console.log(`${page.data.length} passage(s) pour « ${question} »${values["sans-filtre"] ? " (sans filtre)" : ` (en vigueur le ${values.date}${types.length ? `, ${types.join(", ")}` : ""})`}\n`);
for (const [i, r] of page.data.entries()) {
  const a = r.attributes ?? {};
  const texte = r.content.map((c) => c.text).join(" ").replace(/\s+/g, " ");
  console.log(`${String(i + 1).padStart(2)}. ${r.score.toFixed(3)}  ${r.filename}  (${a.type}, du ${date(a.debut)} au ${date(a.fin)})`);
  console.log(`    ${texte.slice(0, 110)}${texte.length > 110 ? "…" : ""}`);
}
