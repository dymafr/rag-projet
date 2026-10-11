// Mesurer la récupération de Rhéa sur le jeu d'évaluation : pour chaque question couverte, les passages trouvés
// comparés aux passages attendus, puis la moyenne de chaque métrique. Pas de réponse rédigée : le LLM ne sert qu'aux
// filtres extraits, à la condensation des questions de suite et aux options qui le demandent. --sans-llm coupe les
// deux premiers et refuse les options : la mesure redevient rapide, gratuite, et se passe d'Ollama, comme en CI
// Lancement : npm run eval:recherche -- [--k 8] [--minimums eval/minimums.json] [--traces eval/traces/vectorielle.json]
//             [--sans-llm] et les options de recherche (src/recherche/options.ts) : [--mode vectorielle] [--vocabulaire]…
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { pool } from "../db.ts";
import { nomDuModele } from "../embeddings/fournisseurs.ts";
import { lireJeu } from "../eval/jeu.ts";
import { Minimums, mesurerRecuperation, moyennes, sousLeMinimum } from "../eval/recuperation.ts";
import type { FichierDeTraces } from "../eval/traces.ts";
import { PASSAGES_DEMANDES } from "../generation/prompt.ts";
import { condenser } from "../recherche/conversation.ts";
import { decrire, lireReglages, OPTIONS_RECHERCHE } from "../recherche/options.ts";
import { aujourdhui, outilsParDefaut, trouverPassages, type Outils } from "../recherche/passages.ts";

const { values } = parseArgs({
  allowNegative: true, // --no-vocabulaire : désactiver une option booléenne
  options: {
    ...OPTIONS_RECHERCHE,
    k: { type: "string", default: String(PASSAGES_DEMANDES) },
    minimums: { type: "string" },
    traces: { type: "string" },
    "sans-llm": { type: "boolean", default: false },
  },
});
// Les minimums sont lus avant la mesure : un fichier mal écrit s'arrête tout de suite, pas après la recherche
let minimums: Minimums | undefined;
if (values.minimums) {
  const lus = Minimums.safeParse(JSON.parse(await readFile(values.minimums, "utf8")));
  if (!lus.success) throw new Error(`${values.minimums} invalide :\n${z.prettifyError(lus.error)}`);
  minimums = lus.data;
}
const k = Number(values.k);
if (!Number.isInteger(k) || k < 1) throw new Error("--k attend un nombre entier positif, par exemple --k 8");
const reglages = lireReglages(values);
// --sans-llm : les étapes du LLM sont coupées, les options qui le demandent sont refusées, et la recherche ne reçoit
// pas de LLM (une étape oubliée s'arrêterait avec un message, au lieu d'attendre Ollama)
if (values["sans-llm"]) {
  if (reglages.transformation || (reglages.reclassement && reglages.reclasseur === "llm")) throw new Error("--sans-llm : ces options demandent le LLM");
  reglages.filtresExtraits = false;
  reglages.condensation = false;
}
const { llm, crossEncoder } = outilsParDefaut();
const outils: Outils = values["sans-llm"] ? { crossEncoder } : { llm, crossEncoder };
// On regarde plus loin que k pour dire où sont tombés les passages manqués
const PROFONDEUR = 50;

// Les questions hors corpus et interdites n'ont pas de passages attendus : elles serviront à mesurer l'abstention
const couvertes = (await lireJeu()).filter((q) => q.categorie === "couverte");
const mesures = [];
const traces: FichierDeTraces["traces"] = [];
for (const q of couvertes) {
  // Une question de suite est d'abord condensée avec son historique, comme le fait Rhéa (leçon 8)
  const question = reglages.condensation && q.historique ? await condenser(q.question, q.historique, llm) : q.question;
  const resultats = await trouverPassages(pool, question, k, q.date, reglages, outils, PROFONDEUR);
  const autonome = question !== q.question ? { autonome: question } : {};
  traces.push({ id: q.id, question: q.question, ...autonome, candidats: resultats.map((r) => ({ id: r.id, score: Number(r.score.toFixed(4)) })) });
  const trouves = resultats.map((r) => r.id);
  const m = mesurerRecuperation(trouves, q.passages, k);
  mesures.push(m);
  // Les passages attendus absents des k premiers, avec leur note et leur rang s'ils sont un peu plus loin
  const manques = Object.entries(q.passages)
    .filter(([id]) => !trouves.slice(0, k).includes(id))
    .map(([id, note]) => `${id} (${note}, ${trouves.includes(id) ? `rang ${trouves.indexOf(id) + 1}` : `au-delà de ${trouves.length}`})`);
  console.log(
    `${q.id}  succès ${m.succes}  rappel ${m.rappel.toFixed(2)}  précision ${m.precision.toFixed(2)}  RR ${m.rangReciproque.toFixed(2)}  nDCG ${m.ndcg.toFixed(2)}  ${q.question}` +
      (manques.length > 0 ? `\n      manqués : ${manques.join(", ")}` : ""),
  );
}
await pool.end();

// Les traces : les candidats de chaque question, pour les analyser ensuite sans relancer la recherche (npm run eval:diagnostic)
if (values.traces) {
  const fichier: FichierDeTraces = { date: aujourdhui(), embeddings: nomDuModele(), recherche: decrire(reglages), profondeur: PROFONDEUR, traces };
  await mkdir(dirname(values.traces), { recursive: true });
  await writeFile(values.traces, `${JSON.stringify(fichier, null, 2)}\n`);
}

const moy = moyennes(mesures);
console.log(`\n${couvertes.length} questions couvertes, recherche ${decrire(reglages)}, k = ${k}`);
console.log(`succès@${k} ${moy.succes.toFixed(3)}  rappel@${k} ${moy.rappel.toFixed(3)}  précision@${k} ${moy.precision.toFixed(3)}  MRR ${moy.rangReciproque.toFixed(3)}  nDCG@${k} ${moy.ndcg.toFixed(3)}`);

// En intégration continue : le code de sortie 1 fait échouer le job quand une moyenne passe sous son minimum
if (minimums) {
  const echecs = sousLeMinimum(moy, minimums);
  for (const e of echecs) console.log(`ÉCHEC : ${e.cle} ${e.valeur.toFixed(3)}, sous le minimum ${e.minimum}`);
  if (echecs.length > 0) process.exitCode = 1;
  else console.log(`Toutes les moyennes atteignent leur minimum (${values.minimums})`);
}
