// Étiqueter à la main les réponses enregistrées : pour chacune, vos propres verdicts sur les critères du juge.
// Ils servent de référence pour calibrer le juge. Une réponse déjà étiquetée, au même texte, n'est pas reposée
// Lancement : npm run eval:etiqueter -- [--reponses eval/reponses.json] [--etiquettes eval/etiquettes.json]
// (Entrée sans réponse pour s'arrêter)
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { type Etiquette, lireEtiquettes } from "../eval/calibration.ts";
import { lireJeu } from "../eval/jeu.ts";
import { empreinte, lireReponses } from "../eval/reponses.ts";

const { values } = parseArgs({
  options: { reponses: { type: "string", default: "eval/reponses.json" }, etiquettes: { type: "string", default: "eval/etiquettes.json" } },
});
const FICHIER = values.etiquettes; // un autre fichier permet de s'exercer sans toucher aux vraies étiquettes
const etiquettes = existsSync(FICHIER) ? await lireEtiquettes(FICHIER) : [];
const jeu = new Map((await lireJeu()).map((q) => [q.id, q]));
const { reponses } = await lireReponses(values.reponses);
// Les lignes tapées, lues une à une. L'itérateur les garde en file d'attente : rien n'est perdu si plusieurs
// arrivent d'un coup (un copier-coller, ou des réponses envoyées par un script avec |)
const terminal = createInterface({ input: process.stdin });
const lignes = terminal[Symbol.asyncIterator]();
async function lire(invite: string): Promise<string | null> {
  process.stdout.write(invite);
  const { value, done } = await lignes.next();
  return done ? null : value.trim();
}

// Une question fermée : o pour oui, n pour non, rien pour arrêter
async function demander(question: string): Promise<boolean | null> {
  for (;;) {
    const r = (await lire(`${question} (o/n) `))?.toLowerCase();
    if (!r) return null;
    if (r === "o" || r === "n") return r === "o";
  }
}

const aFaire = reponses.filter((r) => r.abstention === null && !etiquettes.some((e) => e.id === r.id && e.empreinte === empreinte(r.texte)));
console.log(`${aFaire.length} réponse(s) à étiqueter\n`);
for (const r of aFaire) {
  const q = jeu.get(r.id);
  console.log(`=== ${r.id} : ${r.question}\n`);
  for (const p of r.passages) console.log(`[${p.numero}] ${p.id}\n${p.texte}\n`);
  if (q?.categorie === "couverte") console.log(`Référence : ${q.reponse}\n`);
  console.log(`Réponse de Rhéa :\n${r.texte}\n`);
  const fidelite = await demander("Chaque information figure-t-elle dans les passages ?");
  if (fidelite === null) break;
  const pertinence = await demander("La réponse traite-t-elle toute la question posée ?");
  if (pertinence === null) break;
  const exactitude = q?.categorie === "couverte" ? await demander("Donne-t-elle l'essentiel de la référence, sans la contredire ?") : undefined;
  if (exactitude === null) break;
  const note = (await lire("Une note (facultative) : ")) ?? "";
  const etiquette: Etiquette = { id: r.id, empreinte: empreinte(r.texte), fidelite, pertinence, ...(exactitude !== undefined && { exactitude }), ...(note && { note }) };
  // On remplace l'ancienne étiquette de cette question, et on enregistre tout de suite : on peut s'arrêter à tout moment
  const autres = etiquettes.filter((e) => e.id !== r.id);
  etiquettes.splice(0, etiquettes.length, ...autres, etiquette);
  etiquettes.sort((a, b) => a.id.localeCompare(b.id));
  await writeFile(FICHIER, `${JSON.stringify(etiquettes, null, 2)}\n`);
  console.log();
}
terminal.close();
console.log(`${etiquettes.length} étiquette(s) dans ${FICHIER}`);
