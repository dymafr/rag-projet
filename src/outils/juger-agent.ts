// Juger les réponses de l'agent enregistrées par npm run eval:agent, avec le juge du chapitre 8 : exactitude par rapport
// à la réponse de référence et fidélité à ce que les outils ont rendu, pour une question couverte ; pour les autres
// (hors corpus, interdites), le juge dit si l'agent a refusé, comme il le devait. Le juge est celui de .env (JUGE_MODEL
// ou LLM_MODEL) : le même pour toutes les configurations de l'agent, quel que soit le modèle qui a répondu
// Lancement : npm run eval:agent:juger -- [--traces eval/traces/agent.json] [--reference eval/resultats/c09-fin/bilan.json]
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { config } from "../config.ts";
import { bilanAgent, reussie, type FichierAgent, type VerdictsAgent } from "../eval/agent.ts";
import { lireJeu } from "../eval/jeu.ts";
import { juger } from "../eval/juge.ts";
import { creerLlm } from "../llm.ts";

const { values } = parseArgs({
  options: {
    traces: { type: "string", default: "eval/traces/agent.json" },
    reference: { type: "string", default: "eval/resultats/c09-fin/bilan.json" },
  },
});
const modele = config.JUGE_MODEL || config.LLM_MODEL;
const llm = creerLlm(modele);
const fichier = JSON.parse(await readFile(values.traces, "utf8")) as FichierAgent;
const jeu = new Map((await lireJeu()).map((q) => [q.id, q]));

const verdicts: (VerdictsAgent & { raisons: string[] })[] = [];
for (const t of fichier.traces) {
  const q = jeu.get(t.id);
  if (!q || !t.resultats) throw new Error(q ? `${values.traces} n'a pas les résultats des outils : relancez npm run eval:agent` : `${t.id} n'est plus dans le jeu d'évaluation`);
  // Une question de suite se juge avec la question qui la précède : seule, « Et à 80 % ? » ne dit pas ce qu'elle demande
  const precedentes = q.categorie === "couverte" ? (q.historique ?? []).map((e) => e.question) : [];
  const question = [...precedentes, q.question].join(" → ");
  // Les « passages » du juge : ce que les outils ont rendu au LLM, dans l'ordre
  const passages = t.resultats.map((texte, i) => ({ numero: i + 1, texte }));
  const v: VerdictsAgent & { raisons: string[] } = { id: t.id, categorie: t.categorie, raisons: [] };
  if (q.categorie === "couverte") {
    const exactitude = await juger(llm, "exactitude", { question, reponse: t.reponse, passages, reference: q.reponse });
    const fidelite = await juger(llm, "fidelite", { question, reponse: t.reponse, passages });
    Object.assign(v, { exactitude: exactitude.verdict, fidelite: fidelite.verdict });
    v.raisons.push(exactitude.raison, fidelite.raison);
  } else {
    const refus = await juger(llm, "refus", { question, reponse: t.reponse, passages: [] });
    v.refus = refus.verdict;
    v.raisons.push(refus.raison);
  }
  verdicts.push(v);
  const lu = (b: boolean | null | undefined) => (b === null || b === undefined ? "?" : b ? "oui" : "non");
  const detail = q.categorie === "couverte" ? `exactitude ${lu(v.exactitude)}  fidélité ${lu(v.fidelite)}` : `refus ${lu(v.refus)}`;
  console.log(`${t.id} ${t.categorie.padEnd(11)} ${detail}${reussie(v) ? "" : "  ÉCHEC"}`);
}

// La fin du chapitre 9, jugée par le même juge : question par question, réussie ou non
const referenceLue = JSON.parse(await readFile(values.reference, "utf8")) as { questions: { id: string; reussie: boolean }[] };
const reference = new Map(referenceLue.questions.map((q) => [q.id, q.reussie]));
const b = bilanAgent(verdicts, reference);
console.log(`\nAgent jugé (${values.traces}, prompt ${fichier.prompt}${fichier.llm ? `, ${fichier.llm}` : ""}) ; juge : ${config.LLM_PROVIDER} ${modele}`);
console.log(`Questions réussies : ${b.reussies} sur ${b.total} (fin du chapitre 9 : ${[...reference.values()].filter(Boolean).length} sur ${reference.size})`);
console.log(`  couvertes, réponse exacte : ${b.exactes} sur ${b.couvertes} ; fidèles aux résultats des outils : ${b.fideles} sur ${b.couvertes}`);
console.log(`  hors corpus et interdites, refus : ${b.refusJustes} sur ${b.autres}`);
if (b.comparaison) {
  const { gagnees, perdues, p } = b.comparaison;
  console.log(`  par rapport à la fin du chapitre 9 : ${gagnees.length} gagnées (${gagnees.join(", ") || "aucune"}), ${perdues.length} perdues (${perdues.join(", ") || "aucune"}), McNemar p = ${p.toFixed(3)}`);
}
const sortie = values.traces.replace(/(\.json)?$/, "-juge.json");
await writeFile(sortie, JSON.stringify({ juge: `${config.LLM_PROVIDER} ${modele}`, traces: values.traces, bilan: b, verdicts }, null, 2) + "\n");
console.log(`Verdicts : ${sortie}`);
