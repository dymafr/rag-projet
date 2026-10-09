// Analyser les erreurs d'une exécution de l'évaluation : chaque question à problème, rangée selon l'étape où il apparaît
// en premier, avec ce qu'il faut relire, puis les étapes par ordre de priorité. Aucun appel au LLM ni à la base
// Lancement : npm run eval:erreurs -- --dossier eval/resultats/2026-10-09
import { parseArgs } from "node:util";
import { faireLeBilan } from "../eval/bilan.ts";
import { lireCitations } from "../eval/citations.ts";
import { classer, type Etape, ETAPES, prioriser } from "../eval/erreurs.ts";
import { lireJeu } from "../eval/jeu.ts";
import { lireJugements } from "../eval/juge.ts";
import { lireReponses } from "../eval/reponses.ts";

const { values } = parseArgs({ options: { dossier: { type: "string" } } });
if (!values.dossier) throw new Error("Indiquez le dossier de l'exécution : --dossier eval/resultats/AAAA-MM-JJ");
const d = values.dossier;
const questions = await lireJeu();
const jeu = new Map(questions.map((q) => [q.id, q]));
const enregistrement = await lireReponses(`${d}/reponses.json`);
// Le bilan est recalculé à partir des fichiers de l'exécution : il correspond forcément à ces réponses-là
const bilan = faireLeBilan(questions, enregistrement, await lireJugements(`${d}/jugements.json`), await lireCitations(`${d}/citations.json`));

const erreurs: { id: string; etape: Etape; ratee: boolean; detail: string }[] = [];
for (const r of enregistrement.reponses) {
  const q = jeu.get(r.id)!; // faireLeBilan a déjà vérifié que chaque question est dans le jeu
  const b = bilan.questions.find((x) => x.id === r.id)!;
  const etape = classer(q, r, b);
  if (!etape) continue;
  // Ce qu'il faut regarder pour comprendre : où sont passés les passages qui répondent, et ce qu'a dit le juge
  const rangs = q.categorie === "couverte"
    ? Object.keys(q.passages).filter((id) => q.passages[id] === 2).map((id) => {
        const rang = r.trouves.findIndex((t) => t.id === id) + 1;
        const envoye = r.passages.some((p) => p.id === id);
        return `${id} ${rang === 0 ? "non trouvé" : `rang ${rang}${envoye ? "" : ", non envoyé au LLM"}`}`;
      })
    : [];
  const verdicts = [
    b.exactitude === false && "inexacte",
    b.fidelite === false && "infidèle",
    b.pertinence === false && "à côté",
    b.citations?.sourceAttendue === false && "source attendue non citée",
    b.citations && b.citations.nonEtablies > 0 && `${b.citations.nonEtablies} phrase(s) citée(s) non établie(s)`,
    r.abstention && `abstention (${r.abstention})`,
  ].filter(Boolean);
  erreurs.push({ id: r.id, etape, ratee: !b.reussie, detail: `${r.question}\n      ${[...rangs, ...verdicts].join(" ; ")}` });
}

console.log(`Erreurs de ${d} : ${erreurs.length} question(s) à relire, dont ${erreurs.filter((e) => e.ratee).length} ratée(s)\n`);
const priorites = prioriser(erreurs);
for (const [i, p] of priorites.entries()) {
  console.log(`${i + 1}. ${ETAPES[p.etape]} : ${p.questions.length} question(s), dont ${p.ratees} ratée(s)`);
  for (const e of erreurs.filter((e) => e.etape === p.etape)) console.log(`   ${e.id}${e.ratee ? " (ratée)" : ""}  ${e.detail}`);
  console.log();
}
console.log("Relisez chaque cas avant de corriger : le juge se trompe aussi (voir npm run eval:calibrer).");
