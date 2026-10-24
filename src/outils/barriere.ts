// La barrière de qualité (chapitre 14, leçon 5) : avant de déployer, Rhéa repasse le jeu caché, figé à la leçon 2, et le
// jeu d'attaques du chapitre 13. Si elle échoue sur plus de questions que la barrière n'en permet, ou si une seule
// attaque réussit, la commande échoue : l'intégration continue arrête le déploiement.
// Quatre règles, pour que la barrière vérifie vraiment quelque chose :
// 1. le jeu caché est celui qui a été figé (son empreinte n'a pas changé) : on ne retouche pas une question qui gêne ;
// 2. on n'en lit que des scores (par type et par catégorie), jamais quelles questions ont échoué : sinon on finirait par
//    régler Rhéa sur lui, et il ne prouverait plus rien ;
// 3. la règle est écrite avant de mesurer (eval/production/barriere.json), pas choisie après coup selon le résultat ;
// 4. deux juges de deux fournisseurs (leçon 4) : une question n'est réussie que si les deux l'acceptent. Leurs désaccords,
//    seul un relecteur indépendant les tranche, et il ne rend que ses décisions (--relu).
// Lancement : npm run eval:barriere -- [--paralleles 6] [--nom barriere-2026-10-21 : par défaut, la date du jour]
//             npm run eval:barriere -- --relu barriere-2026-10-21 (après la relecture indépendante des désaccords)
// (avec un LLM et des juges qui coûtent : à lancer à la main, ou par la CI avec ses secrets)
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { z } from "zod";
import { A_RELIRE, deciderBarriere, lireJuge, Regle, REGLE, type Accord } from "../eval/barriere.ts";
import { empreinteDe, JEU_CACHE, lireJeuProduction, type Execution } from "../eval/production.ts";
import { auPlus, borneDesEchecs } from "../eval/statistiques.ts";
import { aujourdhui } from "../recherche/passages.ts";

const { values } = parseArgs({ options: { relu: { type: "string" }, nom: { type: "string" }, paralleles: { type: "string", default: "1" } } });
for (const n of [values.relu, values.nom]) if (n && !/^[\w-][\w.-]*$/.test(n)) throw new Error("--relu et --nom attendent un nom d'exécution simple");
const regle = Regle.parse(JSON.parse(await readFile(REGLE, "utf8")));
const EMPREINTE = "eval/production/cache.empreinte";

// 1. Le jeu caché n'a pas changé depuis qu'il a été figé
const notee = (await readFile(EMPREINTE, "utf8")).trim();
if (empreinteDe(await readFile(JEU_CACHE)) !== notee) {
  console.error("Barrière : le jeu caché a changé depuis qu'il a été figé. Refusé.");
  process.exit(1);
}

// Ce que la barrière garde d'une exécution, pour décider de nouveau après la relecture : la règle appliquée, l'accord des
// deux juges, le jeu d'attaques
type Etat = { regle: Regle; accord: Accord; attaquesOk: boolean };
const nom = values.relu ?? values.nom ?? `barriere-${aujourdhui()}`;
const dossier = `eval/production/resultats/${nom}`;
// Une exécution de la barrière ne s'écrase jamais : c'est la trace de ce qui a été mesuré, et quand
if (!values.relu && existsSync(dossier)) throw new Error(`${dossier} existe déjà : donnez un autre nom (--nom), on n'écrase pas une barrière`);
let etat: Etat;
let relus = { reussies: 0, echouees: 0 };
let resume: Omit<Execution, "resultats">;

if (!values.relu) {
  // 2. Rejouer le jeu caché, jugé par les deux juges de la règle : l'outil d'évaluation n'en garde que les scores
  const premier = lireJuge(regle.juges[0]);
  const env = { ...process.env, JUGE_PROVIDER: premier.fournisseur, JUGE_MODEL: premier.modele }; // passent avant .env
  const lancer = (outil: string, args: string[]) => execFileSync(process.execPath, ["--env-file=.env", `src/outils/${outil}`, ...args], { stdio: ["ignore", "pipe", "inherit"], env });
  lancer("evaluer-production.ts", ["--jeu", "cache", "--barriere", "--nom", nom, "--second-juge", regle.juges[1], "--paralleles", values.paralleles]);
  resume = JSON.parse(await readFile(`${dossier}/resume.json`, "utf8"));
  // 3. Le jeu d'attaques, s'il fait partie de la règle (il échoue de lui-même si une attaque réussit)
  let attaquesOk = true;
  if (regle.attaques) {
    try {
      lancer("attaquer.ts", ["--essais", "3"]);
    } catch {
      attaquesOk = false;
    }
  }
  etat = { regle, accord: resume.accord!, attaquesOk };
  await writeFile(`${dossier}/barriere.json`, `${JSON.stringify(etat, null, 2)}\n`);
} else {
  // Après la relecture : la même exécution, la même règle (on ne la change pas en voyant le résultat), et les seules
  // décisions du relecteur, comptées. Elles ne portent que sur les désaccords de cette exécution
  resume = JSON.parse(await readFile(`${dossier}/resume.json`, "utf8"));
  etat = JSON.parse(await readFile(`${dossier}/barriere.json`, "utf8"));
  if (resume.empreinteDuJeu !== notee) throw new Error(`${nom} : cette exécution ne porte pas sur le jeu caché figé`);
  if (JSON.stringify(etat.regle) !== JSON.stringify(regle)) throw new Error(`${REGLE} a changé depuis l'exécution ${nom} : la règle s'écrit avant de mesurer`);
  const aRelire = JSON.parse(await readFile(`${A_RELIRE}/${nom}.json`, "utf8")) as { desaccords: { id: string }[] };
  const ids = new Set(aRelire.desaccords.map((d) => d.id));
  const decisions = z
    .array(z.strictObject({ id: z.string(), reussie: z.boolean() }))
    .parse(JSON.parse(await readFile(`${A_RELIRE}/${nom}.decisions.json`, "utf8")));
  if (decisions.some((d) => !ids.has(d.id)) || new Set(decisions.map((d) => d.id)).size !== decisions.length) {
    throw new Error("Les décisions doivent porter sur les désaccords de cette exécution, chacun une fois au plus");
  }
  relus = { reussies: decisions.filter((d) => d.reussie).length, echouees: decisions.filter((d) => !d.reussie).length };
}

// Toutes les questions du jeu caché ont été jouées : une exécution arrêtée en route (des erreurs de suite) ne décide pas
const attendues = (await lireJeuProduction(JEU_CACHE)).questions.length;
if (resume.bilan.total !== attendues) {
  console.error(`Barrière : ${resume.bilan.total} questions jouées sur ${attendues}. Refusé : elle ne décide pas sur un jeu incomplet.`);
  process.exit(1);
}

// 4. Décider, et dire ce que prouve ce score (leçon 2), sans rien montrer des questions
const { accord, attaquesOk } = etat;
const d = deciderBarriere(regle, accord, relus);
const total = resume.bilan.total;
// Dans la CI, le journal se lit par quiconque voit le dépôt, et se relit à chaque push : des scores relus sans cesse
// finissent par user le jeu caché sans qu'on en lise une question (« The Ladder », Blum et Hardt). On n'y écrit que le
// verdict ; les scores se lisent en lançant la barrière à la main
const enCI = process.env.CI === "true";
if (enCI) console.log("Jeu caché : dans la CI, la barrière ne montre que son verdict");
else {
  console.log(`Jeu caché, ${resume.configuration.juge} et ${resume.configuration.secondJuge} :`);
  console.log(`  ${accord.reussies} réussies et ${accord.echouees} échouées pour les deux juges, ${accord.desaccords} désaccord(s), ${accord.nonJugees} non jugée(s), sur ${total}`);
  if (values.relu) console.log(`  relecture indépendante : ${relus.reussies} désaccord(s) jugé(s) réussi(s), ${relus.echouees} échoué(s)`);
  for (const [type, b] of Object.entries(resume.bilan.parType)) console.log(`  ${type.padEnd(20)} ${b.reussies}/${b.total} (premier juge)`);
  console.log(`Échecs comptés : ${d.echecs} (un désaccord non tranché compte comme un échec), ${regle.echecsPermis} permis`);
  console.log(`Taux d'échec réel au plus ${(100 * borneDesEchecs(d.echecs, total)).toFixed(1).replace(".", ",")} % (95 %, unilatéral)`);
  const chance = (p: number) => (100 * auPlus(regle.echecsPermis, total, p)).toFixed(0);
  console.log(`Une Rhéa qui raterait vraiment 1 % des questions franchirait cette barrière ${chance(0.01)} fois sur 100 ; 5 %, ${chance(0.05)} fois sur 100`);
}
if (regle.attaques) console.log(attaquesOk ? "Jeu d'attaques : aucune attaque réussie" : "Jeu d'attaques : au moins une attaque a réussi");

const ok = d.franchie && attaquesOk;
if (ok) console.log(`\nBarrière franchie (au plus ${regle.echecsPermis} échec(s) permis)`);
else if (d.relireUtile && attaquesOk && !values.relu && !enCI) {
  console.log(`\nBarrière NON franchie pour l'instant : ${d.aTrancher} désaccord(s) à trancher, dont au moins ${d.aAccepter} à juger réussi(s).`);
  console.log(`À confier à un relecteur qui n'a pas réglé Rhéa : ${A_RELIRE}/${nom}.json (hors de git ; ne l'ouvrez pas vous-même).`);
  console.log(`Ses décisions, [{"id": "…", "reussie": true}], dans ${A_RELIRE}/${nom}.decisions.json, puis : npm run eval:barriere -- --relu ${nom}`);
} else if (enCI) console.log(`\nBarrière NON franchie${attaquesOk ? "" : " (une attaque a réussi)"}`);
else console.log(`\nBarrière NON franchie : ${d.echecs} échec(s) pour ${regle.echecsPermis} permis${attaquesOk ? "" : ", et une attaque a réussi"}`);
process.exitCode = ok ? 0 : 1;
