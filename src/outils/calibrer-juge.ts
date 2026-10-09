// Calibrer le juge : ses verdicts (eval/jugements.json) comparés à ceux d'un humain (eval/etiquettes.json), critère
// par critère, avec la liste des désaccords à relire. Aucun appel au LLM
// Lancement : npm run eval:calibrer -- [--jugements eval/jugements.json] [--etiquettes eval/etiquettes.json]
import { parseArgs } from "node:util";
import { comparer, lireEtiquettes, type Paire } from "../eval/calibration.ts";
import { CRITERES_JUGES, lireJugements } from "../eval/juge.ts";
import { wilson } from "../eval/statistiques.ts";

const { values } = parseArgs({
  options: { jugements: { type: "string", default: "eval/jugements.json" }, etiquettes: { type: "string", default: "eval/etiquettes.json" } },
});
const etiquettes = new Map((await lireEtiquettes(values.etiquettes)).map((e) => [e.id, e]));
const { juge, consignes, jugements } = await lireJugements(values.jugements);
const pourcent = (x: number) => `${Math.round(100 * x)} %`;

console.log(`Juge : ${juge}, consignes ${consignes}\n`);
let perimees = 0;
for (const critere of CRITERES_JUGES) {
  const paires: Paire[] = [];
  const desaccords: string[] = [];
  for (const j of jugements.filter((j) => j.critere === critere && j.verdict !== null)) {
    const e = etiquettes.get(j.id);
    const humain = e?.[critere];
    if (e === undefined || humain === undefined) continue; // réponse pas étiquetée pour ce critère
    if (e.empreinte !== j.empreinte) {
      perimees++;
      continue;
    }
    paires.push({ humain, juge: j.verdict! });
    if (humain !== j.verdict) {
      desaccords.push(`  ${j.id} humain ${humain ? "oui" : "non"}, juge ${j.verdict ? "oui" : "non"} : ${j.raison}${e.note ? `\n        note de l'humain : ${e.note}` : ""}`);
    }
  }
  if (paires.length === 0) continue;
  const c = comparer(paires);
  const kappa = c.kappa === null ? "impossible à calculer (toujours le même verdict)" : c.kappa.toFixed(2);
  const { bas, haut } = wilson(c.vraiOui + c.vraiNon, c.n);
  console.log(`${critere} : ${c.n} réponses, accord ${pourcent(c.accord)} (entre ${pourcent(bas)} et ${pourcent(haut)}), kappa ${kappa}`);
  console.log(`  l'humain et le juge disent oui : ${c.vraiOui} ; disent non : ${c.vraiNon}`);
  console.log(`  le juge dit oui, l'humain non : ${c.fauxOui} ; le juge dit non, l'humain oui : ${c.fauxNon}`);
  // Les défauts que l'humain a vus (il dit non) : le juge les voit-il ? Sans défaut étiqueté, impossible de le savoir
  const defauts = c.vraiNon + c.fauxOui;
  console.log(defauts === 0 ? "  aucun défaut étiqueté : impossible de savoir si le juge en voit" : `  défauts vus par le juge : ${c.vraiNon} sur ${defauts}`);
  if (desaccords.length > 0) console.log(`  Désaccords :\n${desaccords.join("\n")}`);
  console.log();
}
if (perimees > 0) console.log(`${perimees} verdict(s) ignoré(s) : la réponse a changé depuis l'étiquetage (npm run eval:etiqueter)`);
