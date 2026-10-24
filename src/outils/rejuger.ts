// Rejuger une exécution avec un autre juge (chapitre 14, leçon 4), sans régénérer les réponses : les mêmes textes, un autre
// verdict. De quoi comparer deux juges à réponses égales, puis relire leurs désaccords (npm run eval:desaccords).
// Le juge est celui de .env (JUGE_PROVIDER, JUGE_MODEL), ou celui que donnent ces variables posées devant la commande.
// Les questions sont celles du jeu de travail actuel : un motif ou une référence corrigés depuis l'exécution s'appliquent
// (l'exécution rejugée prend l'empreinte du jeu actuel).
// Lancement : npm run eval:rejuger -- --depuis base-locale --nom base-locale-juge-claude
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { config } from "../config.ts";
import { verdictDe } from "../eval/juger-production.ts";
import { bilanDe, JEU_DE_TRAVAIL, lireJeuProduction, type Execution, type ResultatQuestion } from "../eval/production.ts";
import { pourLeTerminal } from "../ingestion/secrets.ts";
import { creerLlm } from "../llm.ts";

const { values } = parseArgs({ options: { depuis: { type: "string" }, nom: { type: "string" } } });
const nomSimple = /^[\w-][\w.-]*$/;
if (!values.depuis || !values.nom || !nomSimple.test(values.depuis) || !nomSimple.test(values.nom)) {
  throw new Error("Attendu : --depuis <exécution à rejuger> --nom <nouvelle exécution>, des noms simples");
}
// Une exécution ne s'écrase jamais (celle de référence, surtout) : --nom en donne une nouvelle
if (existsSync(`eval/production/resultats/${values.nom}`)) throw new Error(`eval/production/resultats/${values.nom} existe déjà : donnez un autre nom (--nom)`);
const source = JSON.parse(await readFile(`eval/production/resultats/${values.depuis}/execution.json`, "utf8")) as Execution;
if (source.jeu === "cache") throw new Error("Le jeu caché ne se rejuge pas : on n'en lit que les scores (leçon 5)");
const fournisseur = config.JUGE_PROVIDER ?? config.LLM_PROVIDER;
const modele = config.JUGE_MODEL || config.LLM_MODEL;
const juge = creerLlm(modele, fournisseur);
const { questions, empreinte } = await lireJeuProduction(JEU_DE_TRAVAIL);
const actuelles = new Map(questions.map((q) => [q.id, q]));

// Ce que le juge lit : les passages et ce qu'ont rendu les autres outils. Une exécution plus ancienne ne les a pas tous
// gardés (lus) : on les retrouve dans la trace, dans ce que chaque outil a rendu au LLM (les passages y sont balisés,
// chapitre 7)
function lusDans(r: ResultatQuestion): { id: string; texte: string }[] {
  const outils = r.trace.filter((e) => e.nom === "outil" && !e.details.erreur);
  const passagesDe = (e: (typeof outils)[number]) => (e.details.passages as { id: string }[] | undefined) ?? [];
  const lus = r.obtenu.lus ?? r.obtenu.passagesVus.flatMap((id) => {
    const rendu = outils.find((e) => passagesDe(e).some((p) => p.id === id));
    const texte = rendu ? String(rendu.details.texte).match(new RegExp(`<passage source="${id.replace(/[#-]/g, "\\$&")}"[^>]*>\\n([\\s\\S]*?)\\n</passage>`))?.[1] : undefined;
    return texte ? [{ id, texte }] : [];
  });
  const autres = outils.filter((e) => passagesDe(e).length === 0).map((e) => ({ id: (e.details.appel as { nom: string }).nom, texte: String(e.details.texte) }));
  return [...lus, ...autres.filter((a) => !lus.some((l) => l.id === a.id))];
}

async function rejuger(avant: ResultatQuestion): Promise<ResultatQuestion> {
  const r = { ...avant, question: actuelles.get(avant.question.id) ?? avant.question };
  if (r.obtenu.erreur) return r;
  try {
    return { ...r, verdict: await verdictDe(r.question, { texte: r.obtenu.texte, passagesLus: lusDans(r) }, juge) };
  } catch (erreur) {
    console.error(`${r.question.id} : juge en échec (${pourLeTerminal(erreur instanceof Error ? erreur.message : erreur)})`);
    return { ...r, verdict: { reussie: null, criteres: [] } };
  }
}

// Plusieurs questions à la fois (PARALLELES) : un juge hébergé répond en quelques secondes, et l'ordre est gardé
const PARALLELES = 6;
const debut = performance.now();
const resultats: Execution["resultats"] = [];
for (let i = 0; i < source.resultats.length; i += PARALLELES) {
  const lot = source.resultats.slice(i, i + PARALLELES);
  const rejuges = await Promise.all(lot.map(rejuger));
  for (const [j, r] of rejuges.entries()) {
    const avant = lot[j].verdict.reussie;
    resultats.push(r);
    console.log(`${r.question.id.padEnd(5)} ${r.verdict.reussie === avant ? "même verdict" : `${String(avant)} → ${String(r.verdict.reussie)}`}`);
  }
}
const execution: Execution = {
  ...source,
  nom: values.nom,
  empreinteDuJeu: empreinte,
  configuration: { ...source.configuration, juge: `${fournisseur} ${modele}` },
  duree_ms: Math.round(performance.now() - debut),
  bilan: bilanDe(resultats),
  resultats,
};
const dossier = `eval/production/resultats/${values.nom}`;
await mkdir(dossier, { recursive: true });
const { resultats: _, ...resume } = execution;
await writeFile(`${dossier}/execution.json`, JSON.stringify(execution));
await writeFile(`${dossier}/resume.json`, JSON.stringify(resume));
console.log(`\n${execution.bilan.reussies} réussies sur ${execution.bilan.total} avec ${fournisseur} ${modele} (avant : ${source.bilan.reussies}, juge ${source.configuration.juge})`);
