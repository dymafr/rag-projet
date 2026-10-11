// Ce qui entre dans le prompt : pour chaque question couverte du jeu, les passages que garde le budget (chapitre 7), les
// documents différents, et si le passage qui répond y est. Avec --voisins, deux morceaux qui se suivent dans un même
// document sont recollés avant le budget : le passage recollé garde les titres de son premier morceau, et entre dans le
// budget en entier ou pas du tout. Pas de réponse rédigée : le LLM n'est appelé que pour condenser les questions de
// suite et extraire les filtres de la question
// Lancement : npm run eval:contexte -- [--diversite 0.7] [--voisins] [--k 8] [--budget 1500], et les options de recherche
import { parseArgs } from "node:util";
import { pool } from "../db.ts";
import { lireJeu } from "../eval/jeu.ts";
import { BUDGET_PASSAGES, choisir, estimerTokens, PASSAGES_DEMANDES } from "../generation/prompt.ts";
import { condenser } from "../recherche/conversation.ts";
import { fusionnerVoisins, idsDuPassage } from "../recherche/diversite.ts";
import { decrire, lireReglages, OPTIONS_RECHERCHE } from "../recherche/options.ts";
import { outilsParDefaut, trouverPassages } from "../recherche/passages.ts";

const { values } = parseArgs({
  allowNegative: true,
  options: {
    ...OPTIONS_RECHERCHE,
    k: { type: "string", default: String(PASSAGES_DEMANDES) },
    budget: { type: "string", default: String(BUDGET_PASSAGES) },
    voisins: { type: "boolean", default: false },
  },
});
const k = Number(values.k);
const budget = Number(values.budget);
if (!Number.isInteger(k) || k < 1 || !Number.isInteger(budget) || budget < 1) throw new Error("--k et --budget attendent des nombres entiers positifs");
const reglages = lireReglages(values);
const outils = outilsParDefaut();

const couvertes = (await lireJeu()).filter((q) => q.categorie === "couverte");
let passages = 0;
let chunks = 0;
let documents = 0;
let ecartes = 0;
const manques: string[] = [];
for (const q of couvertes) {
  const question = reglages.condensation && q.historique ? await condenser(q.question, q.historique, outils.llm) : q.question;
  const trouves = await trouverPassages(pool, question, k, q.date, reglages, outils);
  const prompt = choisir(values.voisins ? fusionnerVoisins(trouves) : trouves, budget, estimerTokens);
  const envoyes = prompt.passages.flatMap((p) => idsDuPassage(p.id)); // les chunks envoyés, morceaux recollés compris
  passages += prompt.passages.length;
  chunks += envoyes.length;
  documents += new Set(prompt.passages.map((p) => p.document)).size;
  if (prompt.ecartes.length > 0) ecartes++;
  if (!envoyes.some((id) => q.passages[id] === 2)) manques.push(q.id);
  console.log(`${q.id}  ${prompt.passages.length} passages (${envoyes.length} chunks), ${new Set(prompt.passages.map((p) => p.document)).size} documents : ${prompt.passages.map((p) => p.id).join(" ")}`);
}
await pool.end();

const n = couvertes.length;
const moyenne = (total: number) => (total / n).toFixed(1);
console.log(`\n${n} questions couvertes, recherche ${decrire(reglages)}${values.voisins ? ", voisins recollés" : ""}, k = ${k}, budget ${budget}`);
console.log(`Dans le prompt, en moyenne : ${moyenne(passages)} passages, ${moyenne(chunks)} chunks, ${moyenne(documents)} documents différents`);
console.log(`Le budget écarte au moins un passage pour ${ecartes} question(s) sur ${n}`);
console.log(`Aucun passage qui répond dans le prompt : ${manques.length === 0 ? "aucune question" : manques.join(", ")}`);
