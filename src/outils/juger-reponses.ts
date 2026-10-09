// Faire juger les réponses enregistrées par un LLM : fidélité aux passages, pertinence pour la question et, pour
// les questions couvertes, exactitude par rapport à la réponse de référence. Les abstentions ne sont pas jugées ici
// Lancement : npm run eval:juger -- [--reponses eval/reponses.json] [--sortie eval/jugements.json]
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { config } from "../config.ts";
import { lireJeu } from "../eval/jeu.ts";
import { type Critere, CRITERES, juger, type Jugements } from "../eval/juge.ts";
import { empreinte, lireReponses } from "../eval/reponses.ts";
import { creerLlm } from "../llm.ts";
import { aujourdhui } from "../recherche/passages.ts";

const { values } = parseArgs({
  options: { reponses: { type: "string", default: "eval/reponses.json" }, sortie: { type: "string", default: "eval/jugements.json" } },
});
const modele = config.JUGE_MODEL || config.LLM_MODEL; // JUGE_MODEL vide ou absent : le juge est le modèle de Rhéa
const llm = creerLlm(modele);
const jeu = new Map((await lireJeu()).map((q) => [q.id, q]));
const { reponses } = await lireReponses(values.reponses);

const jugements: Jugements["jugements"] = [];
for (const r of reponses.filter((r) => r.abstention === null)) {
  const q = jeu.get(r.id);
  const reference = q?.categorie === "couverte" ? q.reponse : undefined;
  const criteres: Critere[] = reference ? ["fidelite", "pertinence", "exactitude"] : ["fidelite", "pertinence"];
  const verdicts = [];
  for (const critere of criteres) {
    const j = await juger(llm, critere, { question: r.question, reponse: r.texte, passages: r.passages, reference });
    jugements.push({ id: r.id, empreinte: empreinte(r.texte), critere, verdict: j.verdict, raison: j.raison });
    verdicts.push(`${critere} ${j.verdict === null ? "?" : j.verdict ? "oui" : "non"}`);
  }
  console.log(`${r.id}  ${verdicts.join("  ")}`);
}

// Pour chaque critère, la part des réponses jugées qui le passent
console.log(`\nJuge : ${config.LLM_PROVIDER} ${modele}`);
for (const critere of ["fidelite", "pertinence", "exactitude"] as const) {
  const lus = jugements.filter((j) => j.critere === critere && j.verdict !== null);
  const oui = lus.filter((j) => j.verdict).length;
  const illisibles = jugements.filter((j) => j.critere === critere && j.verdict === null).length;
  console.log(`${critere.padEnd(11)} ${oui}/${lus.length} (${lus.length ? Math.round((100 * oui) / lus.length) : 0} %)${illisibles ? `, ${illisibles} illisible(s)` : ""}`);
}

const consignes = empreinte(Object.values(CRITERES).map((c) => c.consigne).join("\n"));
const fichier: Jugements = { date: aujourdhui(), juge: `${config.LLM_PROVIDER} ${modele}`, consignes, reponses: values.reponses, jugements };
await writeFile(values.sortie, `${JSON.stringify(fichier, null, 2)}\n`);
console.log(`\nVerdicts enregistrés dans ${values.sortie}`);
