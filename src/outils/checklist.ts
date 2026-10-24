// La checklist de mise en production (chapitre 14, leçon 11) : tout ce qui se vérifie par programme avant d'ouvrir Rhéa aux
// salariés, avec la configuration de production. Chaque point est OK, ou dit quoi faire. Un point bloquant échoué fait
// échouer la commande (code de sortie 1) : elle peut garder la porte d'un déploiement, comme la barrière de qualité.
// Ce qu'aucun programme ne vérifie (l'information des salariés, l'analyse d'impact, le contrat avec chaque fournisseur)
// reste dans la checklist du cours.
// Lancement : npm run checklist, depuis le dépôt (elle y lit les résultats de la barrière, le jeu caché et le compose de
// production), avec dans .env la configuration de production et un DATABASE_URL qui atteint la base de production
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { config } from "../config.ts";
import { pool } from "../db.ts";
import { nomDuModele } from "../embeddings/fournisseurs.ts";
import { deciderBarriere, lireJuge, Regle, REGLE, type Accord } from "../eval/barriere.ts";
import { empreinteDe, JEU_CACHE, lireJeuProduction, type Execution } from "../eval/production.ts";
import { plancherMesure } from "../generation/abstention.ts";
import { lirePromptSysteme } from "../generation/systeme.ts";
import { PROMPT_AGENT } from "../agent/rhea.ts";
import { aujourdhui } from "../recherche/passages.ts";
import { lireIndexation } from "../stockage/schema.ts";

type Point = { theme: string; nom: string; ok: boolean; bloquant: boolean; detail: string };
const points: Point[] = [];
const verifier = (theme: string, nom: string, ok: boolean, detail: string, bloquant = true) => points.push({ theme, nom, ok, bloquant, detail });
const recent = (fichier: string, jours: number) => existsSync(fichier) && Date.now() - statSync(fichier).mtimeMs < jours * 86_400_000;
// Un fichier absent ou illisible ne fait pas planter la checklist : le point qui en dépend échoue, et dit quoi faire
const lireJson = (fichier: string): unknown => {
  try {
    return JSON.parse(readFileSync(fichier, "utf8"));
  } catch {
    return null;
  }
};

// 1. La configuration
verifier("configuration", "inspection désactivée", !config.INSPECTION, "INSPECTION=non : sinon le navigateur reçoit le prompt, les passages et les réglages");
// Tous les modèles que sert Rhéa : l'agent, les étapes de la recherche, le repli, les embeddings, le reclasseur
const fournisseurs = new Set([config.LLM_PROVIDER, config.LLM_RECHERCHE_PROVIDER, config.LLM_REPLI_PROVIDER, config.EMBEDDING_PROVIDER, config.RERANK_PROVIDER]);
const ollamaIci = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(config.OLLAMA_BASE_URL).hostname);
verifier("configuration", "fournisseurs hébergés", !fournisseurs.has("ollama") || !ollamaIci, "un modèle local ne tient pas la charge d'une entreprise ; ou bien un serveur Ollama dédié", false);
verifier("configuration", "fournisseur de repli", Boolean(config.LLM_REPLI_PROVIDER) && config.LLM_REPLI_PROVIDER !== config.LLM_PROVIDER, "LLM_REPLI_PROVIDER, chez un autre fournisseur que LLM_PROVIDER (leçon 8)");
// Leçon 4 : le plancher d'abstention que l'agent applique, mesuré pour le modèle d'embedding configuré
verifier("configuration", "plancher d'abstention mesuré pour ce modèle", plancherMesure(nomDuModele()), `aucun plancher pour ${nomDuModele()} dans abstention.ts : le mesurer sur le jeu de travail (leçon 4)`);

// 2. La base : la sécurité par ligne du chapitre 13, l'index et son modèle. Injoignable : un seul point, qui dit pourquoi
try {
  const { rows: rls } = await pool.query<{ rls: boolean; politiques: number }>(
    "SELECT relrowsecurity AS rls, (SELECT count(*)::int FROM pg_policies WHERE tablename = 'chunks') AS politiques FROM pg_class WHERE relname = 'chunks'",
  );
  verifier("base", "sécurité par ligne sur les passages", rls[0]?.rls === true && rls[0].politiques > 0, "npm run indexer la repose : une table reconstruite n'en a pas");
  const { rows: roles } = await pool.query<{ rolname: string }>("SELECT rolname FROM pg_roles WHERE rolname IN ('rhea_recherche', 'rhea_lecture')");
  const manquants = [
    ["rhea_recherche", "rhea_recherche (chapitre 13) : npm run indexer le crée"],
    ["rhea_lecture", "rhea_lecture (chapitre 12) : npm run migrer"],
  ].filter(([role]) => !roles.some((r) => r.rolname === role));
  verifier("base", "rôles de lecture", manquants.length === 0, manquants.map(([, conseil]) => conseil).join(" ; "));
  const indexation = await lireIndexation(pool);
  verifier("base", "index du bon modèle", indexation?.modele === nomDuModele(), `index : ${indexation?.modele ?? "aucun"} ; configuré : ${nomDuModele()} (npm run indexer -- --reconstruire)`);
  // Un index valide seulement : un CREATE INDEX CONCURRENTLY interrompu laisse un index INVALID, que la recherche ignore
  const { rows: hnsw } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pg_indexes i JOIN pg_index x ON x.indexrelid = format('%I.%I', i.schemaname, i.indexname)::regclass
     WHERE i.tablename = 'chunks' AND i.indexdef LIKE '%hnsw%' AND x.indisvalid`,
  );
  verifier("base", "index HNSW", hnsw[0].n > 0, "absent ou invalide : sans lui, chaque recherche lit toute la table");
  const { rows: tables } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_tables WHERE tablename IN ('taches', 'observations', 'retours')");
  verifier("base", "file et observabilité", tables[0].n === 3, "npm run migrer");
} catch (erreur) {
  verifier("base", "base joignable", false, `${(erreur as Error).message} : DATABASE_URL doit atteindre la base de production`);
} finally {
  await pool.end();
}

// 3. La qualité : le jeu caché figé, et une barrière franchie récemment, avec cette configuration et ce prompt
const empreinteNotee = existsSync("eval/production/cache.empreinte") ? readFileSync("eval/production/cache.empreinte", "utf8").trim() : null;
verifier("qualité", "jeu caché figé et inchangé", empreinteNotee !== null && existsSync(JEU_CACHE) && empreinteDe(readFileSync(JEU_CACHE)) === empreinteNotee, "npm run eval:jeu -- --jeu cache --empreinte");
const systeme = await lirePromptSysteme(PROMPT_AGENT);
const version = `v${systeme.version} ${systeme.empreinte}`;
const generation = `${config.LLM_PROVIDER} ${config.LLM_MODEL}`;
// La décision de la barrière elle-même (leçon 5) : l'accord des deux juges de la dernière exécution, sous la règle qu'elle
// a appliquée, qui doit être la règle actuelle (elle s'écrit avant de mesurer) ; un désaccord compte comme un échec, comme
// dans la CI. La dernière, et son âge, se lisent à la date de son résumé : git remet celle des fichiers au checkout
const regle = Regle.safeParse(lireJson(REGLE)).data;
verifier("qualité", "règle de la barrière écrite", regle !== undefined, `${REGLE} absent ou invalide (leçon 5)`);
type Barriere = { nom: string; resume: Omit<Execution, "resultats">; regle: Regle; accord: Accord; attaquesOk: boolean };
const RESULTATS = "eval/production/resultats";
const barrieres: Barriere[] = [];
for (const nom of existsSync(RESULTATS) ? await readdir(RESULTATS) : []) {
  const resume = lireJson(`${RESULTATS}/${nom}/resume.json`) as Barriere["resume"] | null;
  const etat = lireJson(`${RESULTATS}/${nom}/barriere.json`) as Omit<Barriere, "nom" | "resume"> | null;
  if (resume && etat) barrieres.push({ nom, resume, ...etat });
}
// Le nombre de questions du jeu caché (sans rien en lire d'autre) : une barrière jouée en partie ne compte pas
let questionsCachees: number | null = null;
try {
  questionsCachees = (await lireJeuProduction(JEU_CACHE)).questions.length;
} catch {
  // jeu caché absent ou invalide : le point « jeu caché figé et inchangé » le dit
}
const b = barrieres.sort((x, y) => x.resume.date.localeCompare(y.resume.date) || x.nom.localeCompare(y.nom)).at(-1);
if (b) {
  const decision = deciderBarriere(b.regle, b.accord);
  const juges = b.regle.juges.map((j) => `${lireJuge(j).fournisseur} ${lireJuge(j).modele}`);
  const age = (Date.parse(aujourdhui()) - Date.parse(b.resume.date)) / 86_400_000;
  const c = b.resume.configuration;
  const ecarts = [
    age >= 7 && `mesurée le ${b.resume.date}, il y a plus de 7 jours`,
    !decision.franchie && `${decision.echecs} échec(s) comptés pour ${b.regle.echecsPermis} permis`,
    !b.attaquesOk && "une attaque a réussi",
    JSON.stringify(b.regle) !== JSON.stringify(regle) && `${REGLE} a changé depuis cette mesure`,
    (b.resume.jeu !== "cache" || b.resume.empreinteDuJeu !== empreinteNotee) && "elle ne porte pas sur le jeu caché figé",
    b.resume.bilan.total !== questionsCachees && `${b.resume.bilan.total} questions jouées sur ${questionsCachees ?? "?"}`,
    (c.juge !== juges[0] || c.secondJuge !== juges[1]) && `jugée par ${c.juge} et ${c.secondJuge ?? "aucun second juge"}, pas par les juges de la règle`,
    c.generation !== generation && `LLM ${c.generation}, configuré : ${generation}`,
    c.prompt !== version && `prompt ${c.prompt}, actuel : ${version}`,
    c.embeddings !== nomDuModele() && `embeddings ${c.embeddings}, configurés : ${nomDuModele()}`,
  ].filter(Boolean);
  verifier("qualité", "barrière de qualité franchie (7 jours)", ecarts.length === 0, `${b.nom} : ${ecarts.join(" ; ")} (npm run eval:barriere)`);
} else verifier("qualité", "barrière de qualité franchie (7 jours)", false, "aucune : npm run eval:barriere");
// Le jeu d'attaques (chapitre 13) : rejoué avec l'agent depuis moins de 7 jours (eval/traces/ est hors de git : la date du
// fichier est celle de l'exécution), au moins une attaque jouée, et aucun essai réussi pour l'attaquant
const ATTAQUES = "eval/traces/attaques.json";
const attaques = lireJson(ATTAQUES) as { sansLlm: boolean; essais: number; resultats: { essais: { fautes: string[] }[] }[] } | null;
const reussies = attaques ? attaques.resultats.flatMap((r) => r.essais).filter((e) => e.fautes.length > 0).length : 0;
verifier(
  "qualité",
  "jeu d'attaques rejoué (7 jours), aucune attaque réussie",
  attaques !== null && recent(ATTAQUES, 7) && !attaques.sansLlm && attaques.essais > 1 && attaques.resultats.length > 0 && reussies === 0,
  attaques ? `${attaques.resultats.length} attaque(s) jouée(s), ${attaques.essais} essai(s) chacune, ${reussies} essai(s) réussi(s) pour l'attaquant ; npm run eval:attaques (avec l'agent, plusieurs essais)` : "npm run eval:attaques (avec l'agent, plusieurs essais)",
);

// 4. La sécurité : les dépendances, le journal, les secrets
let sortie: string | undefined;
try {
  sortie = execFileSync("npm", ["audit", "--omit=dev", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
} catch (erreur) {
  // npm audit sort en erreur dès qu'il trouve une vulnérabilité : son rapport est quand même sur la sortie
  sortie = (erreur as { stdout?: string }).stdout;
}
// Seul un rapport compte : un registre injoignable donne aussi du JSON, une erreur sans metadata.vulnerabilities
let rapport: { high?: number; critical?: number; moderate?: number } | undefined;
try {
  rapport = sortie ? JSON.parse(sortie).metadata?.vulnerabilities : undefined;
} catch {
  rapport = undefined;
}
const { high = 0, critical = 0, moderate = 0 } = rapport ?? {};
verifier(
  "sécurité",
  "dépendances sans vulnérabilité haute ni critique",
  rapport !== undefined && high + critical === 0,
  rapport ? `${critical} critique(s), ${high} haute(s), ${moderate} modérée(s)` : "audit impossible : npm audit n'a pas rendu de rapport (registre injoignable ?)",
);
const cle = "donnees/journal.cle";
verifier("sécurité", "clé du journal lisible par son seul propriétaire", !existsSync(cle) || (statSync(cle).mode & 0o077) === 0, `${cle} en mode 600 (chapitre 13)`);
const COMPOSE = "compose.production.yaml";
verifier(
  "sécurité",
  "aucun secret dans le compose",
  // une clé (sk-…), une valeur de *API_KEY ou de *PASSWORD écrite en clair, un mot de passe dans une adresse de base ;
  // une variable ${…} ou un fichier *_FILE ne comptent pas
  existsSync(COMPOSE) && !/\bsk-[\w-]{16,}|\b\w*API_KEY\s*:\s*(?!\$\{)\S{12,}|postgres(ql)?:\/\/[^:/\s]+:[^@\s]+@|\bPASSWORD\s*:\s*(?!\$\{)\S+/i.test(readFileSync(COMPOSE, "utf8")),
  existsSync(COMPOSE) ? "les clés vont dans secrets/, montées en fichiers" : `${COMPOSE} introuvable : lancez la checklist depuis le dépôt`,
);

// Le bilan
let theme = "";
for (const p of points) {
  if (p.theme !== theme) console.log(`\n${(theme = p.theme).toUpperCase()}`);
  console.log(`  ${p.ok ? "OK     " : p.bloquant ? "À FAIRE" : "conseil"}  ${p.nom}${p.ok ? "" : `\n           ${p.detail}`}`);
}
const bloquants = points.filter((p) => !p.ok && p.bloquant);
console.log(bloquants.length ? `\n${bloquants.length} point(s) bloquant(s) : pas de mise en production` : "\nTous les points bloquants sont OK");
process.exitCode = bloquants.length ? 1 : 0;
