// Diagnostiquer la récupération à partir d'un fichier de traces (npm run eval:recherche -- --traces …) : pour chaque
// question couverte, où tombe le premier passage qui répond ? Avec --comparer, ce qui change d'une recherche à l'autre.
// Aucun appel à la base ni au LLM : les traces suffisent
// Lancement : npm run eval:diagnostic -- eval/traces/vectorielle.json [--k 8] [--comparer eval/traces/autre.json]
import { parseArgs } from "node:util";
import { comparerDiagnostics, DIAGNOSTICS, diagnostiquerTraces, type Diagnostic, type Ligne } from "../eval/diagnostic.ts";
import { lireJeu } from "../eval/jeu.ts";
import { moyennes } from "../eval/recuperation.ts";
import { lireTraces } from "../eval/traces.ts";
import { PASSAGES_DEMANDES } from "../generation/prompt.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { k: { type: "string", default: String(PASSAGES_DEMANDES) }, comparer: { type: "string" } },
});
if (!positionals[0]) throw new Error("Indiquez un fichier de traces, par exemple : npm run eval:diagnostic -- eval/traces/vectorielle.json");
const k = Number(values.k);
if (!Number.isInteger(k) || k < 1) throw new Error("--k attend un nombre entier positif, par exemple --k 8");

const jeu = await lireJeu();
const traces = await lireTraces(positionals[0]);
const lignes = diagnostiquerTraces(traces, jeu, k);
const decrire = ({ verdict: v }: Ligne) => (v.rang === null ? DIAGNOSTICS.absent : `${DIAGNOSTICS[v.diagnostic]}, rang ${v.rang}`);

console.log(`${positionals[0]} : recherche ${traces.recherche}, ${traces.profondeur} candidats par question, k = ${k} (${traces.date})\n`);
const detail: Record<Diagnostic, (l: Ligne) => string> = {
  trouve: () => "",
  noye: (l) => `${l.id} (rang ${l.verdict.rang}, ${l.verdict.devant} non pertinents devant)`,
  "mal-classe": (l) => `${l.id} (rang ${l.verdict.rang})`,
  absent: (l) => l.id,
};
for (const d of Object.keys(DIAGNOSTICS) as Diagnostic[]) {
  const liste = lignes.filter((l) => l.verdict.diagnostic === d);
  console.log(`${DIAGNOSTICS[d].padEnd(11)} ${String(liste.length).padStart(3)}  ${liste.map(detail[d]).filter(Boolean).join("  ")}`);
}
const moy = moyennes(lignes.map((l) => l.mesures));
const reussies = lignes.filter((l) => l.mesures.succes === 1).length;
console.log(`\n${lignes.length} questions couvertes : succès@${k} ${reussies}/${lignes.length}, MRR ${moy.rangReciproque.toFixed(3)}, nDCG@${k} ${moy.ndcg.toFixed(3)}`);

if (values.comparer) {
  const reference = await lireTraces(values.comparer);
  const c = comparerDiagnostics(diagnostiquerTraces(reference, jeu, k), lignes);
  console.log(`\nComparaison avec ${values.comparer} (recherche ${reference.recherche}) : ${c.changees.length} question(s) changent`);
  for (const { avant, apres } of c.changees) console.log(`  ${apres.id}  ${decrire(avant)} -> ${decrire(apres)}`);
  const a = c.moyennesAvant;
  const b = c.moyennesApres;
  console.log(`  MRR ${a.rangReciproque.toFixed(3)} -> ${b.rangReciproque.toFixed(3)}  nDCG@${k} ${a.ndcg.toFixed(3)} -> ${b.ndcg.toFixed(3)}  rappel@${k} ${a.rappel.toFixed(3)} -> ${b.rappel.toFixed(3)}`);
  console.log(`  Questions gagnées : ${c.gagnees.join(", ") || "aucune"} ; perdues : ${c.perdues.join(", ") || "aucune"} ; test de McNemar : p = ${c.p.toFixed(3)}`);
}
