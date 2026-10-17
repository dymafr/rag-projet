// Charger les données RH dans la base : les salariés fictifs de Kalyo et leurs soldes (corpus/soldes/soldes.sql), puis la
// table des demandes que Rhéa ouvre dans l'espace RH, et, depuis le chapitre 12, l'accès en lecture du text-to-SQL (rôle
// rhea_lecture, sécurité par ligne, vue soldes_visibles). Lancement : npm run donnees:rh [-- --reconstruire]
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { pool } from "../db.ts";
import { SCHEMA_DEMANDES } from "../rh/donnees.ts";
import { preparerAcces } from "../sql/acces.ts";

const { values } = parseArgs({ options: { reconstruire: { type: "boolean", default: false } } });

try {
  // CASCADE : la vue soldes_visibles (chapitre 12) dépend des tables ; elle est recréée plus bas
  if (values.reconstruire) await pool.query("DROP TABLE IF EXISTS demandes_rh, soldes, salaries CASCADE");
  const { rows } = await pool.query<{ existe: boolean }>("SELECT to_regclass('salaries') IS NOT NULL AS existe");
  if (rows[0].existe) {
    console.log("Les salariés sont déjà chargés (relancez avec -- --reconstruire pour tout recharger).");
  } else {
    // Le fichier contient plusieurs instructions : pg les envoie d'un bloc, sans paramètre
    await pool.query(await readFile("corpus/soldes/soldes.sql", "utf8"));
  }
  await pool.query(SCHEMA_DEMANDES);
  await preparerAcces(pool); // chapitre 12, leçon 3
  console.log("Accès en lecture du text-to-SQL prêt : rôle rhea_lecture, sécurité par ligne, vue soldes_visibles");
  const { rows: compte } = await pool.query<{ salaries: string; soldes: string; demandes: string }>(
    "SELECT (SELECT count(*) FROM salaries) AS salaries, (SELECT count(*) FROM soldes) AS soldes, (SELECT count(*) FROM demandes_rh) AS demandes",
  );
  console.log(`Salariés : ${compte[0].salaries} ; soldes : ${compte[0].soldes} ; demandes ouvertes par Rhéa : ${compte[0].demandes}`);
} finally {
  await pool.end();
}
