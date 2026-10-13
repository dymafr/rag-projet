// Charger les données RH dans la base : les salariés fictifs de Kalyo et leurs soldes (corpus/soldes/soldes.sql), puis la
// table des demandes que Rhéa ouvre dans l'espace RH. Lancement : npm run donnees:rh [-- --reconstruire]
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { pool } from "../db.ts";
import { SCHEMA_DEMANDES } from "../rh/donnees.ts";

const { values } = parseArgs({ options: { reconstruire: { type: "boolean", default: false } } });

try {
  if (values.reconstruire) await pool.query("DROP TABLE IF EXISTS demandes_rh, soldes, salaries");
  const { rows } = await pool.query<{ existe: boolean }>("SELECT to_regclass('salaries') IS NOT NULL AS existe");
  if (rows[0].existe) {
    console.log("Les salariés sont déjà chargés (relancez avec -- --reconstruire pour tout recharger).");
  } else {
    // Le fichier contient plusieurs instructions : pg les envoie d'un bloc, sans paramètre
    await pool.query(await readFile("corpus/soldes/soldes.sql", "utf8"));
  }
  await pool.query(SCHEMA_DEMANDES);
  const { rows: compte } = await pool.query<{ salaries: string; soldes: string; demandes: string }>(
    "SELECT (SELECT count(*) FROM salaries) AS salaries, (SELECT count(*) FROM soldes) AS soldes, (SELECT count(*) FROM demandes_rh) AS demandes",
  );
  console.log(`Salariés : ${compte[0].salaries} ; soldes : ${compte[0].soldes} ; demandes ouvertes par Rhéa : ${compte[0].demandes}`);
} finally {
  await pool.end();
}
