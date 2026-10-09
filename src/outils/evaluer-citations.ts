// Évaluer les citations des réponses enregistrées : rappel et précision des citations (juge de soutien), et, sans LLM,
// si la réponse cite au moins un passage qui répond à la question (noté 2 dans le jeu d'évaluation)
// Lancement : npm run eval:citations -- [--reponses eval/reponses.json] [--sortie eval/citations.json]
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { config } from "../config.ts";
import { evaluerCitations } from "../eval/citations.ts";
import { lireJeu } from "../eval/jeu.ts";
import { CRITERES, juger } from "../eval/juge.ts";
import { empreinte, lireReponses } from "../eval/reponses.ts";
import { creerLlm } from "../llm.ts";
import { aujourdhui } from "../recherche/passages.ts";

const { values } = parseArgs({
  options: { reponses: { type: "string", default: "eval/reponses.json" }, sortie: { type: "string", default: "eval/citations.json" } },
});
const modele = config.JUGE_MODEL || config.LLM_MODEL; // JUGE_MODEL vide ou absent : le juge est le modèle de Rhéa
const llm = creerLlm(modele);
const jeu = new Map((await lireJeu()).map((q) => [q.id, q]));
const { reponses } = await lireReponses(values.reponses);
const pourcent = (x: number | null) => (x === null ? "-" : `${Math.round(100 * x)} %`);

const resultats = [];
let appels = 0;
let illisibles = 0;
for (const r of reponses.filter((r) => r.abstention === null)) {
  // Le juge de soutien reçoit une phrase et les seuls passages qu'elle cite
  const citations = await evaluerCitations(r.texte, async (phrase, numeros) => {
    const cites = r.passages.filter((p) => numeros.includes(p.numero));
    if (cites.length < numeros.length) return false; // un numéro qui ne désigne aucun passage reçu n'établit rien
    appels++;
    const j = await juger(llm, "soutien", { question: r.question, reponse: phrase, passages: cites });
    if (j.verdict === null) illisibles++;
    return j.verdict === true; // un verdict illisible compte comme non appuyé (et il est compté)
  });
  // Sans LLM : la réponse cite-t-elle au moins un passage qui répond (noté 2) ? Seulement pour une question couverte
  const q = jeu.get(r.id);
  const sourceAttendue =
    q?.categorie === "couverte" ? r.sources.some((s) => q.passages[s.source] === 2) : null;
  resultats.push({ id: r.id, empreinte: empreinte(r.texte), ...citations, sourceAttendue });
  console.log(
    `${r.id}  rappel ${pourcent(citations.rappel).padStart(5)}  précision ${pourcent(citations.precision).padStart(5)}` +
      `  sans citation ${citations.sansCitation}  source attendue ${sourceAttendue === null ? "-" : sourceAttendue ? "oui" : "non"}`,
  );
}

// Les moyennes sur les réponses jugées (une réponse qui ne cite rien a un rappel de 0 et pas de précision) ;
// la part des réponses qui citent une source attendue
const moyenne = (valeurs: (number | null)[]) => {
  const lues = valeurs.filter((v): v is number => v !== null);
  return lues.length === 0 ? null : lues.reduce((a, b) => a + b, 0) / lues.length;
};
const attendues = resultats.filter((r) => r.sourceAttendue !== null);
console.log(`\nJuge : ${config.LLM_PROVIDER} ${modele}, ${appels} appels${illisibles ? `, ${illisibles} verdict(s) illisible(s)` : ""}`);
console.log(`rappel des citations ${pourcent(moyenne(resultats.map((r) => r.rappel)))}, précision ${pourcent(moyenne(resultats.map((r) => r.precision)))}`);
console.log(`phrases sans citation : ${resultats.reduce((total, r) => total + r.sansCitation, 0)}`);
console.log(`source attendue citée : ${attendues.filter((r) => r.sourceAttendue).length}/${attendues.length}`);

const consignes = empreinte(CRITERES.soutien.consigne);
const fichier = { date: aujourdhui(), juge: `${config.LLM_PROVIDER} ${modele}`, consignes, reponses: values.reponses, resultats };
await writeFile(values.sortie, `${JSON.stringify(fichier, null, 2)}\n`);
console.log(`\nRésultats enregistrés dans ${values.sortie}`);
