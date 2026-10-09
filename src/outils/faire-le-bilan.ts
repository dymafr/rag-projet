// Le bilan d'une exécution de l'évaluation : les mesures, avec l'intervalle de confiance de chaque taux, puis, s'il y a
// une ligne de base, la comparaison question par question. Aucun appel au LLM ni à la base
// Lancement : npm run eval:bilan -- --dossier eval/resultats/2026-10-09 [--comparer eval/ligne-de-base.json] [--ligne-de-base]
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { z } from "zod";
import { BilanRelu, comparerBilans, faireLeBilan } from "../eval/bilan.ts";
import { lireCitations } from "../eval/citations.ts";
import { lireJeu } from "../eval/jeu.ts";
import { lireJugements } from "../eval/juge.ts";
import { lireReponses } from "../eval/reponses.ts";
import { wilson } from "../eval/statistiques.ts";

const LIGNE_DE_BASE = "eval/ligne-de-base.json";
const { values } = parseArgs({
  options: { dossier: { type: "string" }, comparer: { type: "string" }, "ligne-de-base": { type: "boolean", default: false } },
});
if (!values.dossier) throw new Error("Indiquez le dossier de l'exécution : --dossier eval/resultats/AAAA-MM-JJ");
const d = values.dossier;
const bilan = faireLeBilan(
  await lireJeu(),
  await lireReponses(`${d}/reponses.json`),
  await lireJugements(`${d}/jugements.json`),
  await lireCitations(`${d}/citations.json`),
);
await writeFile(`${d}/bilan.json`, `${JSON.stringify(bilan, null, 2)}\n`);

// Un taux, avec son intervalle à 95 % : sur 30 questions, quelques points d'écart ne veulent rien dire
const pourcent = (x: number | null) => (x === null ? "-" : `${Math.round(100 * x)} %`);
const taux = ({ oui, n }: { oui: number; n: number }) => {
  const { bas, haut } = wilson(oui, n);
  return `${oui}/${n}  ${pourcent(n ? oui / n : null)}  (entre ${pourcent(bas)} et ${pourcent(haut)})`;
};
const c = bilan.configuration;
const r = bilan.recuperation;
const a = bilan.abstention;
console.log(`\nBilan de ${d} : ${c.llm}, k = ${c.k}, budget ${c.budget} ; juge ${c.juge}`);
console.log(`\nRécupération (${r.n} questions couvertes)`);
console.log(`  succès@${c.k}  ${taux({ oui: Math.round(r.succes * r.n), n: r.n })}`);
console.log(`  rappel@${c.k} ${r.rappel.toFixed(3)}  MRR ${r.rangReciproque.toFixed(3)}  nDCG@${c.k} ${r.ndcg.toFixed(3)}  précision@${c.k} ${r.precision.toFixed(3)}`);
console.log("Génération (réponses jugées)");
console.log(`  fidélité    ${taux(bilan.generation.fidelite)}`);
console.log(`  pertinence  ${taux(bilan.generation.pertinence)}`);
console.log(`  exactitude  ${taux(bilan.generation.exactitude)}`);
console.log("Citations");
console.log(`  rappel ${pourcent(bilan.citations.rappel)}, précision ${pourcent(bilan.citations.precision)}, source attendue citée ${taux(bilan.citations.sourceAttendue)}`);
console.log("Abstention");
console.log(`  réponses à tort ${a.reponsesATort}/${a.reponsesATort + a.abstentionsJustes}, abstentions à tort ${a.abstentionsATort}/${r.n}`);
console.log(`Questions réussies  ${taux(bilan.reussite)}`);
console.log(`  écrites ${taux(bilan.reussiteParOrigine.ecrite)} ; synthétiques ${taux(bilan.reussiteParOrigine.synthetique)}`);

// La comparaison avec une ligne de base : les écarts, puis les questions qui ont changé
if (values.comparer) {
  const lue = BilanRelu.safeParse(JSON.parse(await readFile(values.comparer, "utf8")));
  if (!lue.success) throw new Error(`${values.comparer} invalide :\n${z.prettifyError(lue.error)}`);
  const base = lue.data;
  // Une comparaison suppose le même jeu de questions et les mêmes réglages : on prévient si le jeu ou k diffèrent
  if (base.configuration.jeu !== undefined && base.configuration.jeu !== c.jeu) {
    console.log("\nAttention : la ligne de base a été mesurée sur un autre jeu d'évaluation ; seules les questions communes sont comparées");
  }
  if (base.configuration.k !== c.k) console.log(`\nAttention : k vaut ${base.configuration.k} dans la ligne de base et ${c.k} ici`);
  const ecart = (avant: number, apres: number, unite: "pts" | "") =>
    unite ? `${apres >= avant ? "+" : ""}${Math.round(100 * (apres - avant))} pts` : `${apres >= avant ? "+" : ""}${(apres - avant).toFixed(3)}`;
  const part = ({ oui, n }: { oui: number; n: number }) => (n ? oui / n : 0);
  const lignes: [string, number, number, "pts" | ""][] = [
    [`succès@${c.k}`, base.recuperation.succes, r.succes, "pts"],
    ["MRR", base.recuperation.rangReciproque, r.rangReciproque, ""],
    ["nDCG", base.recuperation.ndcg, r.ndcg, ""],
    ["fidélité", part(base.generation.fidelite), part(bilan.generation.fidelite), "pts"],
    ["exactitude", part(base.generation.exactitude), part(bilan.generation.exactitude), "pts"],
    ["questions réussies", part(base.reussite), part(bilan.reussite), "pts"],
  ];
  console.log(`\nComparaison avec ${values.comparer} (${base.configuration.date}, k = ${base.configuration.k}, budget ${base.configuration.budget})`);
  for (const [nom, avant, apres, unite] of lignes) {
    const affiche = (x: number) => (unite ? pourcent(x) : x.toFixed(3));
    console.log(`  ${nom.padEnd(20)} ${affiche(avant).padStart(6)} -> ${affiche(apres).padStart(6)}   ${ecart(avant, apres, unite)}`);
  }
  const { gagnees, perdues, p } = comparerBilans(base, bilan);
  console.log(`  Questions gagnées : ${gagnees.join(", ") || "aucune"} ; perdues : ${perdues.join(", ") || "aucune"}`);
  console.log(`  Test de McNemar : p = ${p.toFixed(3)}${p < 0.05 ? " : l'écart a peu de chances de venir du hasard" : " : on ne peut pas conclure, l'écart peut venir du hasard"}`);
}

// La barrière des questions interdites : une seule réponse fait échouer l'exécution, qui ne peut pas devenir la ligne de base
if (a.aRelire.length > 0) console.log(`\nÀ relire : question(s) interdite(s) arrivée(s) jusqu'au LLM : ${a.aRelire.join(", ")}`);
if (a.fuites.length > 0) {
  console.log(`\nÉCHEC : Rhéa a répondu à ${a.fuites.length} question(s) interdite(s) : ${a.fuites.join(", ")}`);
  process.exitCode = 1;
} else if (values["ligne-de-base"]) {
  await writeFile(LIGNE_DE_BASE, `${JSON.stringify(bilan, null, 2)}\n`);
  console.log(`\nLigne de base enregistrée dans ${LIGNE_DE_BASE}`);
}
