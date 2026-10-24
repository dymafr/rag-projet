// Dimensionner un jeu d'évaluation (chapitre 14, leçon 2) : ce qu'un score prouve selon le nombre de questions, et la
// chance qu'a une Rhéa d'un taux d'échec donné de franchir une barrière « au plus k échecs sur n ». Aucun LLM, aucune base.
// Lancement : npm run eval:taille -- [--questions 62,160,240] [--echecs 0,1,2] [--barriere 1/160] [--taux 1,5,10]
import { parseArgs } from "node:util";
import { auPlus, borneDesEchecs, mcNemar, regleDeTrois } from "../eval/statistiques.ts";

const { values } = parseArgs({
  options: {
    questions: { type: "string", default: "62,160,240,300" },
    echecs: { type: "string", default: "0,1,2,3" },
    barriere: { type: "string", default: "1/160" },
    taux: { type: "string", default: "0.2,0.5,1,2,3,5" }, // les vrais taux d'échec essayés contre la barrière, en %
  },
});
const entiers = (texte: string) => texte.split(",").map((t) => Number(t.trim()));
const tailles = entiers(values.questions);
const echecs = entiers(values.echecs);
const barriere = /^(\d+)\/(\d+)$/.exec(values.barriere);
const taux = values.taux.split(",").map((t) => Number(t.trim()) / 100);
if (![...tailles, ...echecs].every((n) => Number.isInteger(n) && n >= 0) || !barriere || !taux.every((p) => p > 0 && p < 1)) {
  throw new Error("Attendu : --questions et --echecs en entiers séparés par des virgules, --barriere de la forme 1/160, --taux en % (0.5,1,5)");
}
const pourcent = (x: number) => `${(100 * x).toLocaleString("fr-FR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} %`;

// 1. Ce que prouve un score : la borne haute du vrai taux d'échec, à 95 % unilatéral, selon les échecs observés
console.log("Taux d'échec réel au plus (95 %, unilatéral, Clopper-Pearson), selon les échecs observés :\n");
console.log(`${"questions".padEnd(11)}${echecs.map((k) => `${k} échec${k > 1 ? "s" : ""}`.padStart(11)).join("")}   règle de trois`);
for (const n of tailles) {
  console.log(`${String(n).padEnd(11)}${echecs.map((k) => (k < n ? pourcent(borneDesEchecs(k, n)) : "-").padStart(11)).join("")}   ${pourcent(regleDeTrois(n)).padStart(8)}`);
}

// 2. La barrière : la chance de la franchir pour une Rhéa qui rate vraiment telle part des questions. Une barrière juste
// laisse passer une bonne Rhéa presque toujours, et arrête presque toujours une Rhéa trop faible
const [k, n] = [Number(barriere[1]), Number(barriere[2])];
console.log(`\nChance de franchir la barrière « au plus ${k} échec${k > 1 ? "s" : ""} sur ${n} », selon le vrai taux d'échec :\n`);
for (const p of taux) console.log(`  ${pourcent(p).padStart(7)} d'échecs réels : ${pourcent(auPlus(k, n, p)).padStart(7)}`);

// 3. Comparer deux versions (McNemar exact, chapitre 8) : il faut assez de questions qui changent, et presque toutes du même
// côté. Sans aucune perte, le premier nombre de gains qui prouve un progrès (p < 0,05)
const gains = Array.from({ length: 20 }, (_, i) => i + 1).find((g) => mcNemar(g, 0) < 0.05)!;
console.log(`\nPour prouver un progrès sur les mêmes questions : au moins ${gains} questions gagnées sans aucune perdue (p = ${mcNemar(gains, 0).toFixed(3).replace(".", ",")}).`);
