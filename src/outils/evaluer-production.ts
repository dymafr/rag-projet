// Évaluer Rhéa sur le jeu de production (chapitre 14, leçon 2) : la Rhéa que sert le serveur (assemblerRhea), question
// par question, avec le salarié et la date de la question, toute sa trace, puis le verdict. L'exécution s'enregistre au fil
// de l'eau dans eval/production/resultats/<nom>/ : execution.json (tout, trace comprise, pour l'interface) et resume.json
// (la configuration et les scores). Une exécution coupée reprend où elle s'était arrêtée (--reprendre).
// Lancement : npm run eval:production -- [--nom 2026-10-20] [--questions Q01,Q63] [--types hors-corpus,interdite]
//             [--sans-juge] [--reprendre] [--paralleles 4 : plusieurs questions à la fois, avec des modèles hébergés]
// Le jeu caché (--jeu cache) n'est rejoué que par la barrière de qualité (leçon 5) : sans --barriere, refusé. Il ne garde
// que ses scores, jamais ses questions ni ses réponses : personne ne doit pouvoir régler Rhéa dessus
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { agir } from "../agent/boucle.ts";
import { assemblerRhea, outilsDeRhea, PROMPT_AGENT } from "../agent/rhea.ts";
import { sourcesCitees } from "../agent/sources.ts";
import { config } from "../config.ts";
import { pool } from "../db.ts";
import { nomDuModele } from "../embeddings/fournisseurs.ts";
import { cout, lireTarifs } from "../eval/comparaison.ts";
import { verdictDe } from "../eval/juger-production.ts";
import { bilanDe, JEU_CACHE, JEU_DE_TRAVAIL, lireJeuProduction, TYPES, type Execution, type QuestionProduction, type ResultatQuestion } from "../eval/production.ts";
import { lirePromptSysteme } from "../generation/systeme.ts";
import { pourLeTerminal } from "../ingestion/secrets.ts";
import { creerLlm, type Usage } from "../llm.ts";
import { profilDuSalarie } from "../recherche/droits.ts";
import { aujourdhui, RECHERCHE_DE_PRODUCTION } from "../recherche/passages.ts";
import { decrire } from "../recherche/options.ts";
import type { Resultat } from "../recherche/vectorielle.ts";
import { avecTrace, Trace } from "../trace/trace.ts";

const { values } = parseArgs({
  options: {
    jeu: { type: "string", default: "travail" },
    nom: { type: "string", default: aujourdhui() },
    questions: { type: "string" },
    types: { type: "string" },
    "sans-juge": { type: "boolean", default: false },
    reprendre: { type: "boolean", default: false },
    barriere: { type: "boolean", default: false },
    paralleles: { type: "string", default: "1" },
  },
});
const paralleles = Number(values.paralleles);
if (!Number.isInteger(paralleles) || paralleles < 1 || paralleles > 16) throw new Error("--paralleles attend un entier de 1 à 16");
if (values.jeu !== "travail" && values.jeu !== "cache") throw new Error("--jeu attend travail ou cache");
const cache = values.jeu === "cache";
if (cache && !values.barriere) throw new Error("Le jeu caché ne se rejoue que par la barrière de qualité (leçon 5) : npm run eval:barriere");
// Et en entier : le score d'une question choisie dirait si elle passe, de quoi régler Rhéa sur elle
if (cache && (values.questions || values.types)) throw new Error("Le jeu caché se rejoue en entier : ni --questions ni --types");
// Le nom devient un dossier : des lettres, des chiffres, des tirets ou des points, rien qui sorte de eval/production
if (!/^[\w-][\w.-]*$/.test(values.nom)) throw new Error("--nom attend un nom simple, par exemple --nom base-locale");
const types = values.types?.split(",") ?? [];
if (types.some((t) => !(TYPES as readonly string[]).includes(t))) throw new Error(`--types attend des types parmi : ${TYPES.join(", ")}`);

const { questions: toutes, empreinte } = await lireJeuProduction(cache ? JEU_CACHE : JEU_DE_TRAVAIL);
const choisies = new Set(values.questions?.split(",") ?? []);
const questions = toutes.filter((q) => (choisies.size === 0 || choisies.has(q.id)) && (types.length === 0 || types.includes(q.type)));
const dossier = `eval/production/resultats/${values.nom}`;
await mkdir(dossier, { recursive: true });

const systeme = await lirePromptSysteme(PROMPT_AGENT);
const outils = outilsDeRhea(pool);
const tarifs = await lireTarifs();
// Le juge : JUGE_MODEL chez JUGE_PROVIDER (chapitre 14 : un autre fournisseur que celui qui rédige, de préférence)
const fournisseurDuJuge = config.JUGE_PROVIDER ?? config.LLM_PROVIDER;
const juge = values["sans-juge"] ? null : creerLlm(config.JUGE_MODEL || config.LLM_MODEL, fournisseurDuJuge);
const cleTarif = `${config.LLM_PROVIDER} ${config.LLM_MODEL}`;

// Une exécution à reprendre : les questions déjà faites, si le jeu n'a pas changé entre-temps
let resultats: ResultatQuestion[] = [];
if (values.reprendre) {
  try {
    const avant = JSON.parse(await readFile(`${dossier}/execution.json`, "utf8")) as Execution;
    if (avant.empreinteDuJeu !== empreinte) throw new Error(`${dossier} : le jeu a changé depuis cette exécution, recommencez-la sous un autre nom`);
    resultats = avant.resultats.filter((r) => !r.obtenu.erreur); // une question en erreur (réseau, juge) se refait
  } catch (erreur) {
    if ((erreur as NodeJS.ErrnoException).code !== "ENOENT") throw erreur;
  }
}
const faites = new Set(resultats.map((r) => r.question.id));

const debut = performance.now();
const configuration: Execution["configuration"] = {
  generation: cleTarif,
  juge: juge ? `${fournisseurDuJuge} ${config.JUGE_MODEL || config.LLM_MODEL}` : "aucun",
  embeddings: nomDuModele(),
  reclasseur: !RECHERCHE_DE_PRODUCTION.reclassement ? null : config.RERANK_PROVIDER === "llm" ? `llm ${config.LLM_PROVIDER} ${config.LLM_MODEL}` : `${config.RERANK_PROVIDER} ${config.RERANK_MODEL}`,
  prompt: `v${systeme.version} ${systeme.empreinte}`,
  recherche: decrire(RECHERCHE_DE_PRODUCTION),
};

// Enregistrer : d'abord dans un fichier voisin, puis le renommer. Une coupure en pleine écriture ne laisse jamais un
// fichier à moitié écrit, et --reprendre retrouve la dernière version complète
async function enregistrer() {
  const couts = resultats.map((r) => r.obtenu.cout);
  const execution: Execution = {
    nom: values.nom,
    jeu: values.jeu as Execution["jeu"],
    empreinteDuJeu: empreinte,
    date: aujourdhui(),
    configuration,
    duree_ms: Math.round(performance.now() - debut),
    cout: couts.every((c) => c === null) ? null : couts.reduce<number>((s, c) => s + (c ?? 0), 0),
    bilan: bilanDe(resultats),
    resultats: cache ? [] : resultats, // le jeu caché : les scores, jamais les questions
  };
  const { resultats: _, ...resume } = execution;
  for (const [fichier, contenu] of [["execution.json", execution], ["resume.json", resume]] as const) {
    await writeFile(`${dossier}/${fichier}.tmp`, JSON.stringify(contenu));
    await rename(`${dossier}/${fichier}.tmp`, `${dossier}/${fichier}`);
  }
}

// Une question : la Rhéa du serveur, avec le salarié et la date de la question, toute sa trace, puis le verdict
async function evaluer(q: QuestionProduction): Promise<ResultatQuestion> {
  // Le salarié de la question doit avoir ce profil dans l'annuaire : sinon, la question est fausse, pas Rhéa
  const profil = await profilDuSalarie(pool, q.matricule);
  if (profil !== q.profil) {
    // Le jeu caché ne se montre pas, même dans une erreur : le journal de la CI la garderait
    throw new Error(cache ? "une question du jeu caché donne un profil que l'annuaire ne confirme pas" : `${q.id} : ${q.matricule} a le profil ${profil ?? "inconnu"} dans l'annuaire, pas ${q.profil}`);
  }
  const trace = new Trace();
  // Pas de confirmation : une action demandée pendant l'évaluation est refusée, rien ne s'écrit dans l'espace RH
  const agent = assemblerRhea(outils, { systeme: systeme.texte, matricule: q.matricule });
  const vus: Resultat[] = [];
  const outilsAppeles: string[] = [];
  let texte = "";
  let usage: Usage = { entree: 0, enCache: 0, sortie: 0 };
  let tours = 0;
  let erreur: string | undefined;
  const t0 = performance.now();
  try {
    await avecTrace(trace, async () => {
      for await (const e of agir(q.question, agent, { date: q.date, matricule: q.matricule, profil: q.profil }, q.historique ?? [])) {
        if (e.type === "appel") outilsAppeles.push(e.appel.nom);
        if (e.type === "resultat") vus.push(...(e.resultat.passages ?? []));
        if (e.type === "reponse") ({ texte, usage, tours } = { texte: e.texte, usage: e.usage, tours: e.tour });
      }
    });
  } catch (e) {
    erreur = pourLeTerminal(e instanceof Error ? e.message : e);
  }
  const duree_ms = Math.round(performance.now() - t0);
  const { citees, inventees } = sourcesCitees(texte, vus);
  const passagesLus = [...new Map(vus.map((p) => [p.id, { id: p.id, texte: p.texte }])).values()];
  // Le juge peut tomber en panne aussi (Ollama surchargé, limite de débit) : la question reste alors non jugée, et compte
  // comme un échec de suite, plutôt que d'arrêter toute l'exécution
  let verdict: ResultatQuestion["verdict"] = { reussie: null, criteres: [] };
  if (!erreur) {
    try {
      verdict = await verdictDe(q, { texte, passagesLus }, juge);
    } catch (e) {
      erreur = `juge en échec : ${pourLeTerminal(e instanceof Error ? e.message : e)}`;
    }
  }
  const prix = cout(usage, 0, cleTarif, tarifs);
  return {
    question: q,
    obtenu: {
      texte,
      citees: citees.map((p) => p.id),
      inventees,
      passagesVus: [...new Set(vus.map((p) => p.id))],
      outils: outilsAppeles,
      usage,
      cout: prix ? prix.max : null,
      duree_ms,
      tours,
      ...(erreur && { erreur }),
    },
    verdict,
    trace: trace.etapes,
  };
}

// Les questions à faire, PARALLELES à la fois (--paralleles ; 1 par défaut : un modèle local n'irait pas plus vite). Chaque
// question a sa propre trace (avecTrace), elles ne se mélangent pas ; les résultats s'enregistrent au fil de l'eau, dans
// l'ordre du jeu, une écriture après l'autre. Pas après chaque question : le fichier, traces comprises, grossit (environ
// 25 mégaoctets pour 400 questions), le réécrire prend de plus en plus de temps, et les questions attendaient
// l'écriture. Au plus une écriture toutes les dix secondes, et toujours une à la fin
const aFaire = questions.filter((q) => !faites.has(q.id));
const rang = new Map(questions.map((q, i) => [q.id, i]));
let ecriture = Promise.resolve();
let derniereEcriture = 0;
const enregistrerParfois = async (toutDeSuite = false) => {
  if (!toutDeSuite && performance.now() - derniereEcriture < 10_000) return;
  derniereEcriture = performance.now();
  await (ecriture = ecriture.then(enregistrer));
};
let echecsDeSuite = 0;
let arret = false;
async function travailleur() {
  for (let q = aFaire.shift(); q && !arret; q = aFaire.shift()) {
    const r = await evaluer(q);
    resultats.push(r);
    resultats.sort((a, b) => rang.get(a.question.id)! - rang.get(b.question.id)!);
    await enregistrerParfois();
    // Le jeu caché : rien de la question à l'écran, seulement l'avancement
    const etat = r.verdict.reussie === true ? "réussie " : r.verdict.reussie === false ? "ÉCHOUÉE " : "non jugée";
    const { erreur, duree_ms } = r.obtenu;
    const ligne = cache ? `${resultats.length}/${questions.length}` : `${q.id.padEnd(5)} ${q.type.padEnd(20)} ${etat} ${(duree_ms / 1000).toFixed(1).padStart(5)} s  ${q.question.slice(0, 70)}`;
    console.log(erreur && !cache ? `${ligne}\n      erreur : ${erreur}` : ligne);
    // Cinq échecs de suite : une panne (Ollama arrêté, base injoignable), pas Rhéa. On s'arrête : --reprendre continuera
    echecsDeSuite = erreur ? echecsDeSuite + 1 : 0;
    if (echecsDeSuite >= 5 && !arret) {
      arret = true;
      console.error("\nCinq questions de suite en échec : évaluation arrêtée. Réparez, puis relancez avec --reprendre.");
    }
  }
}
await Promise.all(Array.from({ length: paralleles }, travailleur));
await enregistrerParfois(true);
await pool.end();

const { reussies, jugees, total } = bilanDe(resultats);
console.log(`\n${reussies} réussies sur ${total} (${jugees} jugées) : ${dossier}/resume.json`);
