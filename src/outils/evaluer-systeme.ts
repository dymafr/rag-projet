// Faire répondre un système aux questions du jeu d'évaluation (chapitre 11, leçon 4) : le pipeline maison, la réécriture
// LangChain ou le RAG géré d'OpenAI. Pour chaque question, on enregistre au format des traces de l'agent (chapitre 10) ce
// que le système a lu et répondu, ses tokens, ses appels de recherche facturés et sa durée ; npm run eval:agent:juger
// juge ensuite ces traces avec le même juge, et npm run eval:comparer met les systèmes côte à côte
// Lancement : npm run eval:systeme -- --systeme maison|langchain|file-search [--date 2026-10-16] [--traces eval/traces/<systeme>.json]
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { config } from "../config.ts";
import { pool } from "../db.ts";
import type { FichierAgent, TraceAgent } from "../eval/agent.ts";
import { centile } from "../eval/comparaison.ts";
import { lireJeu } from "../eval/jeu.ts";
import { systemeFileSearch, systemeLangChain, systemeMaison, type Systeme } from "../eval/systemes.ts";
import { creerMagasin } from "../frameworks/langchain.ts";
import { lirePromptSysteme, type PromptSysteme } from "../generation/systeme.ts";
import { clientOpenAI } from "../gere/client.ts";
import { lireStore } from "../gere/store.ts";
import { aujourdhui } from "../recherche/passages.ts";

const SYSTEMES = ["maison", "langchain", "file-search"];
const { values } = parseArgs({
  options: { systeme: { type: "string" }, date: { type: "string", default: aujourdhui() }, traces: { type: "string" } },
});
const nom = values.systeme ?? "";
if (!SYSTEMES.includes(nom)) throw new Error(`--systeme attend ${SYSTEMES.join(", ")}`);
if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date)) throw new Error("--date attend une date AAAA-MM-JJ");
const fichierTraces = values.traces ?? `eval/traces/${nom}.json`;

// Chaque système avec son prompt : celui du pipeline (chapitre 7) pour les deux premiers, celui du RAG géré pour file_search
let systeme: Systeme;
let prompt: PromptSysteme;
let llm: string;
if (nom === "file-search") {
  if (!config.FILE_SEARCH_MODEL) throw new Error("FILE_SEARCH_MODEL manque dans .env");
  prompt = await lirePromptSysteme("prompts/rhea-file-search.md");
  systeme = systemeFileSearch(clientOpenAI(), config.FILE_SEARCH_MODEL, (await lireStore()).id, prompt);
  llm = `openai ${config.FILE_SEARCH_MODEL}`;
} else {
  prompt = await lirePromptSysteme();
  systeme = nom === "maison" ? systemeMaison(pool, prompt) : systemeLangChain(await creerMagasin(pool), prompt);
  llm = `${config.LLM_PROVIDER} ${config.LLM_MODEL}`;
  // Une première question, non mesurée, charge le modèle d'embedding et le LLM local : sans elle, la première question
  // du jeu paierait ce chargement, et fausserait la latence
  await systeme("Combien de jours de congés ai-je par an ?", values.date, []);
}

const traces: TraceAgent[] = [];
try {
  for (const q of await lireJeu()) {
    const debut = performance.now();
    const historique = q.categorie === "couverte" ? (q.historique ?? []) : [];
    const r = await systeme(q.question, q.date ?? values.date, historique);
    const secondes = Math.round((performance.now() - debut) / 100) / 10;
    const documents = [...new Set(r.passages.map((p) => p.document))];
    const trace: TraceAgent = {
      id: q.id,
      categorie: q.categorie,
      question: q.question,
      appels: [],
      // Ce que le modèle a lu, que le juge lira aussi : chaque passage précédé de sa source
      resultats: r.passages.map((p) => `[${p.id ?? p.document}] ${p.texte}`),
      tours: 1,
      dernierTour: false,
      succes: null,
      documents,
      succesDocument: null,
      cites: r.cites,
      inventees: [],
      tokens: r.usage.entree + r.usage.sortie,
      secondes,
      reponse: r.reponse,
      usage: r.usage,
      recherchesFacturees: r.recherches,
    };
    if (q.categorie === "couverte") {
      // Un passage qui répond (pertinence 2) parmi ceux lus : seulement avec les identifiants de Rhéa. OpenAI découpe à
      // sa façon : on regarde alors si le document qui répond est parmi ceux lus
      if (r.passages.every((p) => p.id)) trace.succes = r.passages.some((p) => q.passages[p.id!] === 2);
      const attendus = new Set(Object.entries(q.passages).filter(([, n]) => n === 2).map(([id]) => id.split("#")[0]));
      trace.succesDocument = documents.some((d) => attendus.has(d));
    }
    traces.push(trace);
    const trouve = trace.succesDocument === null ? "" : trace.succesDocument ? " trouvé" : " MANQUÉ";
    console.log(`${q.id} ${q.categorie.padEnd(11)} ${String(r.passages.length).padStart(2)} passage(s), ${secondes.toFixed(1)} s${trouve}`);
  }
} finally {
  await pool.end();
}

const couvertes = traces.filter((t) => t.categorie === "couverte");
const moyenne = (liste: number[]) => Math.round(liste.reduce((s, n) => s + n, 0) / Math.max(1, liste.length));
const secondes = traces.map((t) => t.secondes);
console.log(`\nSystème ${nom} (${llm}, prompt v${prompt.version}), date ${values.date}`);
console.log(`  le document qui répond parmi ceux lus : ${couvertes.filter((t) => t.succesDocument).length} sur ${couvertes.length}`);
if (couvertes.every((t) => t.succes !== null)) console.log(`  un passage qui répond parmi ceux lus : ${couvertes.filter((t) => t.succes).length} sur ${couvertes.length}`);
console.log(`  par question : ${moyenne(traces.map((t) => t.usage!.entree))} tokens en entrée, ${moyenne(traces.map((t) => t.usage!.sortie))} en sortie`);
console.log(`  durée : médiane ${centile(secondes, 50).toFixed(1)} s, 95e centile ${centile(secondes, 95).toFixed(1)} s`);
if (nom === "file-search") console.log(`  appels de file_search : ${traces.reduce((s, t) => s + (t.recherchesFacturees ?? 0), 0)}`);
await mkdir(dirname(fichierTraces), { recursive: true });
const fichier: FichierAgent = { date: values.date, prompt: `v${prompt.version} ${prompt.empreinte}`, toursMax: 1, llm, systeme: nom, traces };
await writeFile(fichierTraces, `${JSON.stringify(fichier, null, 2)}\n`);
console.log(`Traces : ${fichierTraces} (à juger avec npm run eval:agent:juger -- --traces ${fichierTraces})`);
