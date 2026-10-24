// Mesurer la recherche seule sur le jeu de production (chapitre 14, leçon 3) : pour chaque question documentaire, les
// passages que rend la recherche de Rhéa (celle de l'outil chercher_documents), avec le salarié et la date de la question,
// comparés aux passages attendus. Aucun LLM qui rédige : on compare des embeddings et des reclasseurs en quelques minutes,
// avant de payer des générations. Le modèle d'embedding et le reclasseur viennent de .env (ou de variables posées devant
// la commande) ; la base doit avoir été indexée avec ce modèle d'embedding.
// Lancement : npm run eval:recuperation -- [--nom local] [--k 8] [--reclassement] [--reclasseur llm] [--candidats 50]
//             [--vocabulaire] [--transformation multiplier] [--sans-llm]
// --sans-llm : sans les filtres extraits de la question ni la condensation (gratuit avec n'importe quel fournisseur)
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { config } from "../config.ts";
import { pool } from "../db.ts";
import { nomDuModele } from "../embeddings/fournisseurs.ts";
import { lireJeuProduction, type QuestionProduction } from "../eval/production.ts";
import { mesurerRecuperation, moyennes, type MesuresRecuperation } from "../eval/recuperation.ts";
import { PASSAGES_DEMANDES } from "../generation/prompt.ts";
import { condenser } from "../recherche/conversation.ts";
import { aujourdhui, LLM_DE_LA_RECHERCHE, nomDuReclasseur, outilsParDefaut, trouverPassages } from "../recherche/passages.ts";
import { RECHERCHE, RECLASSEURS, type Reglages } from "../recherche/reglages.ts";
import { TRANSFORMATIONS, type Transformation } from "../recherche/transformations.ts";

const { values } = parseArgs({
  options: {
    nom: { type: "string", default: aujourdhui() },
    k: { type: "string", default: String(PASSAGES_DEMANDES) },
    reclassement: { type: "boolean", default: RECHERCHE.reclassement },
    candidats: { type: "string", default: String(RECHERCHE.candidats) },
    "sans-llm": { type: "boolean", default: false },
    reclasseur: { type: "string", default: config.RERANK_PROVIDER === "llm" ? "llm" : RECHERCHE.reclasseur }, // celui de .env par défaut : cross-encoder (local ou Voyage) ou llm
    vocabulaire: { type: "boolean", default: RECHERCHE.vocabulaire },
    transformation: { type: "string" }, // reecrire, multiplier, hyde ou decomposer (chapitre 9, leçon 6)
  },
});
if (!/^[\w-][\w.-]*$/.test(values.nom)) throw new Error("--nom attend un nom simple, par exemple --nom local");
// Une mesure ne s'écrase jamais : deux mesures du même jour (le nom par défaut) se comparent, elles ne se remplacent pas
const dossier = "eval/production/recuperation";
if (existsSync(`${dossier}/${values.nom}.json`)) throw new Error(`${dossier}/${values.nom}.json existe déjà : donnez un autre nom (--nom)`);
const [k, candidats] = [Number(values.k), Number(values.candidats)];
if (!Number.isInteger(k) || k < 1 || !Number.isInteger(candidats) || candidats < 1) throw new Error("--k et --candidats attendent des entiers positifs");
if (values.transformation && !(TRANSFORMATIONS as readonly string[]).includes(values.transformation)) throw new Error(`--transformation attend ${TRANSFORMATIONS.join(", ")}`);
if (!(RECLASSEURS as readonly string[]).includes(values.reclasseur)) throw new Error(`--reclasseur attend ${RECLASSEURS.join(" ou ")}`);
const reglages: Reglages = {
  ...RECHERCHE,
  reclassement: values.reclassement,
  reclasseur: values.reclasseur as Reglages["reclasseur"],
  vocabulaire: values.vocabulaire,
  ...(values.transformation && { transformation: values.transformation as Transformation }),
  candidats,
  ...(values["sans-llm"] && { filtresExtraits: false, condensation: false }),
};

// Les questions où la recherche doit trouver quelque chose : celles qui attendent des passages
const { questions } = await lireJeuProduction();
const documentaires = questions.filter((q): q is QuestionProduction & { passages: Record<string, 1 | 2> } => q.passages !== undefined);
const outils = outilsParDefaut();

type Mesure = { id: string; type: string; mesures: MesuresRecuperation; trouves: string[]; duree_ms: number };
const resultats: Mesure[] = [];
for (const q of documentaires) {
  // Une question de suite se cherche condensée, comme le fait la recherche de secours de l'agent
  const requete = q.historique && reglages.condensation ? await condenser(q.question, q.historique, outils.llm) : q.question;
  const debut = performance.now();
  const trouves = (await trouverPassages(pool, requete, k, q.profil, q.date, reglages, outils)).map((p) => p.id);
  resultats.push({ id: q.id, type: q.type, mesures: mesurerRecuperation(trouves, q.passages, k), trouves, duree_ms: Math.round(performance.now() - debut) });
}
await pool.end();

const moy = moyennes(resultats.map((r) => r.mesures));
const pct = (x: number) => `${(100 * x).toFixed(1).replace(".", ",")} %`;
const configuration = {
  embeddings: nomDuModele(),
  reclasseur: !reglages.reclassement ? "aucun" : `${nomDuReclasseur(reglages.reclasseur)}${reglages.reclasseur === "llm" ? "" : ` sur ${reglages.candidats}`}`,
  vocabulaire: reglages.vocabulaire,
  transformation: reglages.transformation,
  k,
  llm: values["sans-llm"] ? "aucun" : LLM_DE_LA_RECHERCHE,
};
console.log(`${documentaires.length} questions documentaires ; ${configuration.embeddings}, reclasseur ${configuration.reclasseur}, k = ${k}\n`);
console.log(`  succès@${k}  ${pct(moy.succes)}   (au moins un passage qui répond)`);
console.log(`  rappel@${k}  ${pct(moy.rappel)}   MRR ${moy.rangReciproque.toFixed(3).replace(".", ",")}   nDCG@${k} ${moy.ndcg.toFixed(3).replace(".", ",")}`);
const manquees = resultats.filter((r) => r.mesures.succes === 0);
console.log(`  manquées (aucun passage qui répond) : ${manquees.length ? manquees.map((r) => r.id).join(", ") : "aucune"}`);
await mkdir(dossier, { recursive: true });
await writeFile(`${dossier}/${values.nom}.json`, `${JSON.stringify({ date: aujourdhui(), configuration, moyennes: moy, resultats }, null, 2)}\n`);
console.log(`\nDétail : ${dossier}/${values.nom}.json`);
