// Vérifier le jeu d'évaluation avant de s'en servir : le format de chaque question, puis chaque passage attendu, qui
// doit exister dans la base, être ouvert à tous et en vigueur à la date de la question. Sinon la recherche ne peut pas
// le rendre, et les scores baissent sans que Rhéa y soit pour rien
// Lancement : npm run eval:verifier
import { pool } from "../db.ts";
import { lireJeu } from "../eval/jeu.ts";
import { aujourdhui } from "../recherche/passages.ts";

const jeu = await lireJeu(); // s'arrête avec la liste des erreurs si le format ne va pas

const attendus = [...new Set(jeu.flatMap((q) => (q.categorie === "couverte" ? Object.keys(q.passages) : [])))];
// ::text donne les dates au format AAAA-MM-JJ, qui se comparent comme des chaînes
const { rows } = await pool.query<{ id: string; acces: string; debut: string; fin: string | null }>(
  "SELECT id, acces, date_effet::text AS debut, date_fin::text AS fin FROM chunks WHERE id = ANY($1)",
  [attendus],
);
await pool.end();
const chunks = new Map(rows.map((r) => [r.id, r]));

// Ce qui empêcherait la recherche de rendre ce passage pour une question posée ce jour-là, ou null
function probleme(id: string, jour: string): string | null {
  const c = chunks.get(id);
  if (!c) return "absent de la base";
  if (c.acces !== "tous") return `réservé (accès ${c.acces})`;
  if (c.debut > jour || (c.fin !== null && c.fin <= jour)) return `hors vigueur le ${jour}`;
  return null;
}

let erreurs = 0;
for (const q of jeu) {
  if (q.categorie !== "couverte") continue;
  for (const id of Object.keys(q.passages)) {
    const p = probleme(id, q.date ?? aujourdhui()); // la date de la question, sinon celle du jour
    if (p) {
      console.log(`${q.id} : le passage ${id} est ${p}`);
      erreurs++;
    }
  }
}

// La composition du jeu, pour voir d'un coup d'œil s'il reste équilibré
const compter = (cle: (q: (typeof jeu)[number]) => string) =>
  Object.entries(Object.groupBy(jeu, cle)).map(([nom, questions]) => `${nom} ${questions!.length}`).join(", ");
console.log(`${jeu.length} questions : ${compter((q) => q.categorie)} ; ${compter((q) => q.origine)}`);
console.log(`${attendus.length} passages attendus différents, ${erreurs} problème(s)`);
if (erreurs > 0) process.exitCode = 1;
