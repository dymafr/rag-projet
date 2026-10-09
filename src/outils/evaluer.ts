// L'évaluation complète de Rhéa, en une commande : les réponses aux questions du jeu, les verdicts du juge, les
// citations, puis le bilan, comparé à la ligne de base si elle existe. Chaque exécution garde ses fichiers dans son
// propre dossier ; relancer une exécution du même nom remplace ses fichiers
// Lancement : npm run eval -- [--nom AAAA-MM-JJ] [--k 8] [--budget 1500] [--ligne-de-base]
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import { BUDGET_PASSAGES, PASSAGES_DEMANDES } from "../generation/prompt.ts";
import { aujourdhui } from "../recherche/passages.ts";

const LIGNE_DE_BASE = "eval/ligne-de-base.json";
const { values } = parseArgs({
  options: {
    nom: { type: "string", default: aujourdhui() }, // le nom du dossier : la date, ou le nom d'une expérience
    k: { type: "string", default: String(PASSAGES_DEMANDES) },
    budget: { type: "string", default: String(BUDGET_PASSAGES) },
    "ligne-de-base": { type: "boolean", default: false }, // ce bilan devient la nouvelle référence
  },
});
// Le nom devient un dossier : des lettres, des chiffres, des tirets ou des points, rien qui sorte de eval/resultats
if (!/^[\w-][\w.-]*$/.test(values.nom)) throw new Error("--nom attend un nom simple, par exemple --nom budget-2500");
const dossier = `eval/resultats/${values.nom}`;
await mkdir(dossier, { recursive: true });

// Chaque étape lance tel quel un outil du projet, le bilan compris. Si l'une échoue, elle a déjà affiché son
// erreur : on arrête tout, avec un code de sortie non nul
function etape(outil: string, options: string[]) {
  console.log(`\n=== ${outil} ${options.join(" ")}`);
  try {
    execFileSync(process.execPath, ["--env-file=.env", `src/outils/${outil}`, ...options], { stdio: "inherit" });
  } catch {
    console.error(`\nL'étape ${outil} a échoué : évaluation arrêtée.`);
    process.exit(1);
  }
}
etape("enregistrer-reponses.ts", ["--sortie", `${dossier}/reponses.json`, "--k", values.k, "--budget", values.budget]);
etape("juger-reponses.ts", ["--reponses", `${dossier}/reponses.json`, "--sortie", `${dossier}/jugements.json`]);
etape("evaluer-citations.ts", ["--reponses", `${dossier}/reponses.json`, "--sortie", `${dossier}/citations.json`]);
etape("faire-le-bilan.ts", [
  "--dossier",
  dossier,
  ...(existsSync(LIGNE_DE_BASE) ? ["--comparer", LIGNE_DE_BASE] : []),
  ...(values["ligne-de-base"] ? ["--ligne-de-base"] : []),
]);
