// Vérifier un jeu de production (chapitre 14, leçon 2) avant de s'en servir : son schéma, puis, dans la base et l'annuaire,
// que chaque salarié a bien le profil de la question, que chaque passage attendu existe, se lit avec ce profil et
// s'applique à la date de la question. Puis la couverture : les quotas par type, les profils, les documents peu interrogés.
// Lancement : npm run eval:jeu -- [--jeu travail|cache] [--figer] [--empreinte]
// Le jeu caché ne s'affiche jamais : pour lui, des comptes et des identifiants de question seulement. --figer note son
// empreinte (eval/production/cache.empreinte) : à faire une fois, quand il est écrit et relu, avant tout réglage.
// --empreinte vérifie qu'il n'a pas changé depuis (l'intégration continue le fait à chaque push, leçon 5)
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { pool } from "../db.ts";
import { empreinteDe, JEU_CACHE, JEU_DE_TRAVAIL, lireJeuProduction, QUOTAS, TYPES } from "../eval/production.ts";
import { NIVEAUX, PROFILS, type Profil } from "../recherche/droits.ts";

export const EMPREINTE_DU_CACHE = "eval/production/cache.empreinte";

const { values } = parseArgs({ options: { jeu: { type: "string", default: "travail" }, figer: { type: "boolean", default: false }, empreinte: { type: "boolean", default: false } } });
if (values.jeu !== "travail" && values.jeu !== "cache") throw new Error("--jeu attend travail ou cache");
const cache = values.jeu === "cache";
const fichier = cache ? JEU_CACHE : JEU_DE_TRAVAIL;

// L'empreinte seule : sans base, sans rien lire du contenu
if (values.empreinte) {
  const notee = (await readFile(EMPREINTE_DU_CACHE, "utf8")).trim();
  const actuelle = empreinteDe(await readFile(JEU_CACHE));
  console.log(notee === actuelle ? `Jeu caché inchangé (${actuelle.slice(0, 12)})` : "Le jeu caché a changé depuis qu'il a été figé : refusé");
  process.exit(notee === actuelle ? 0 : 1);
}

const { questions, empreinte } = await lireJeuProduction(fichier);
const problemes: string[] = [];
const signaler = (id: string, probleme: string, detail: string) => problemes.push(cache ? `${id}  ${probleme}` : `${id}  ${probleme} : ${detail}`);

// 1. L'annuaire : le profil de chaque salarié de question
const { rows: salaries } = await pool.query<{ matricule: string; role: Profil }>("SELECT matricule, role FROM salaries");
const roles = new Map(salaries.map((s) => [s.matricule, s.role]));
// 2. Les passages : leur niveau d'accès et leurs dates (lus en propriétaire de la table : on vérifie le jeu, pas Rhéa)
const { rows: chunks } = await pool.query<{ id: string; document: string; acces: string; date_effet: Date; date_fin: Date | null }>(
  "SELECT id, document, acces, date_effet, date_fin FROM chunks",
);
await pool.end();
const passages = new Map(chunks.map((c) => [c.id, c]));
const jour = (d: Date) => d.toLocaleDateString("sv-SE");

for (const q of questions) {
  const role = roles.get(q.matricule);
  if (role !== q.profil) signaler(q.id, "profil", `${q.matricule} est ${role ?? "inconnu"} dans l'annuaire, la question dit ${q.profil}`);
  const date = q.enVigueurLe ?? q.date;
  for (const id of Object.keys(q.passages ?? {})) {
    const c = passages.get(id);
    if (!c) signaler(q.id, "passage inconnu", id);
    else if (!NIVEAUX[q.profil].includes(c.acces)) signaler(q.id, "passage illisible pour ce profil", `${id} (${c.acces})`);
    else if (jour(c.date_effet) > date || (c.date_fin && jour(c.date_fin) <= date)) signaler(q.id, "passage pas en vigueur à la date", `${id} (${date})`);
  }
}

// 3. La couverture
const parType = Object.fromEntries(TYPES.map((t) => [t, questions.filter((q) => q.type === t).length]));
const parProfil = Object.fromEntries(PROFILS.map((p) => [p, questions.filter((q) => q.profil === p).length]));
console.log(`${fichier} : ${questions.length} questions, empreinte ${empreinte.slice(0, 12)}\n`);
console.log("Par type (quota) :");
for (const t of TYPES) {
  const quota = QUOTAS[t][cache ? "cache" : "travail"];
  console.log(`  ${t.padEnd(20)} ${String(parType[t]).padStart(4)}  (${quota})${parType[t] === quota ? "" : "  ← écart"}`);
}
console.log(`Par profil : ${PROFILS.map((p) => `${p} ${parProfil[p]}`).join(", ")}`);
if (!cache) {
  const cites = new Map<string, number>();
  for (const q of questions) for (const d of q.documents) cites.set(d, (cites.get(d) ?? 0) + 1);
  const documents = [...new Set(chunks.map((c) => c.document))];
  const peu = documents.filter((d) => !d.startsWith("TK-") && (cites.get(d) ?? 0) < 3).sort();
  console.log(`Documents (hors tickets) interrogés moins de 3 fois : ${peu.length ? peu.map((d) => `${d} (${cites.get(d) ?? 0})`).join(", ") : "aucun"}`);
  console.log(`Tickets interrogés : ${documents.filter((d) => d.startsWith("TK-") && cites.has(d)).length}`);
}
console.log(problemes.length ? `\n${problemes.length} problème(s) :\n  ${problemes.join("\n  ")}` : "\nAucun problème.");

// 4. Figer le jeu caché : son empreinte, notée une fois pour toutes, quand il est relu et sans problème
if (values.figer) {
  if (!cache) throw new Error("--figer ne concerne que le jeu caché (--jeu cache)");
  if (problemes.length) throw new Error("Le jeu caché a des problèmes : corrigez-les avant de le figer");
  await writeFile(EMPREINTE_DU_CACHE, `${empreinte}\n`);
  console.log(`Jeu caché figé : ${EMPREINTE_DU_CACHE}`);
}
process.exitCode = problemes.length ? 1 : 0;
