// Mesurer la récupération de Rhéa sur le jeu d'évaluation : pour chaque question couverte, les passages trouvés
// comparés aux passages attendus, puis la moyenne de chaque métrique. Aucun appel au LLM : la mesure est rapide et gratuite
// Lancement : npm run eval:recherche -- [--k 8]
import { parseArgs } from "node:util";
import { pool } from "../db.ts";
import { lireJeu } from "../eval/jeu.ts";
import { mesurerRecuperation, moyennes } from "../eval/recuperation.ts";
import { PASSAGES_DEMANDES } from "../generation/prompt.ts";
import { trouverPassages } from "../recherche/passages.ts";

const { values } = parseArgs({ options: { k: { type: "string", default: String(PASSAGES_DEMANDES) } } });
const k = Number(values.k);
if (!Number.isInteger(k) || k < 1) throw new Error("--k attend un nombre entier positif, par exemple --k 8");
const PROFONDEUR = Math.max(k, 20); // on regarde plus loin que k pour dire où sont tombés les passages manqués

// Les questions hors corpus et interdites n'ont pas de passages attendus : elles serviront à mesurer l'abstention
const couvertes = (await lireJeu()).filter((q) => q.categorie === "couverte");
const mesures = [];
for (const q of couvertes) {
  const trouves = (await trouverPassages(pool, q.question, PROFONDEUR, q.date)).map((r) => r.id);
  const m = mesurerRecuperation(trouves, q.passages, k);
  mesures.push(m);
  // Les passages attendus absents des k premiers, avec leur note et leur rang s'ils sont un peu plus loin
  const manques = Object.entries(q.passages)
    .filter(([id]) => !trouves.slice(0, k).includes(id))
    .map(([id, note]) => `${id} (${note}, ${trouves.includes(id) ? `rang ${trouves.indexOf(id) + 1}` : `au-delà de ${PROFONDEUR}`})`);
  console.log(
    `${q.id}  succès ${m.succes}  rappel ${m.rappel.toFixed(2)}  précision ${m.precision.toFixed(2)}  RR ${m.rangReciproque.toFixed(2)}  nDCG ${m.ndcg.toFixed(2)}  ${q.question}` +
      (manques.length > 0 ? `\n      manqués : ${manques.join(", ")}` : ""),
  );
}
await pool.end();

const moy = moyennes(mesures);
console.log(`\n${couvertes.length} questions couvertes, k = ${k}`);
console.log(`succès@${k} ${moy.succes.toFixed(3)}  rappel@${k} ${moy.rappel.toFixed(3)}  précision@${k} ${moy.precision.toFixed(3)}  MRR ${moy.rangReciproque.toFixed(3)}  nDCG@${k} ${moy.ndcg.toFixed(3)}`);
