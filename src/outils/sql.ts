// Poser une question chiffrée sur les soldes, en SQL écrit par le LLM, avec les droits d'un salarié ; ou essayer une
// requête écrite à la main (--requete) pour voir les barrières : la validation, puis la base. Sans l'agent.
// Lancement : npm run sql -- "question" --matricule K0006
//             npm run sql -- --requete "SELECT count(*) FROM soldes_visibles" --matricule K0042
import { parseArgs } from "node:util";
import { pool } from "../db.ts";
import { creerLlm } from "../llm.ts";
import { executerEnLecture, perimetre } from "../sql/acces.ts";
import { enTexte, interroger } from "../sql/texte-vers-sql.ts";
import { validerSql } from "../sql/valider.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { matricule: { type: "string" }, requete: { type: "string" } },
});
const matricule = values.matricule ?? "";
if (!/^K\d{4}$/.test(matricule) || (!values.requete && !positionals[0])) {
  console.error('Attendu : une question entre guillemets (ou --requete "SELECT …"), et --matricule au format K0042');
  process.exit(1);
}

try {
  console.log(`Salarié ${matricule} : ${await perimetre(pool, matricule)}`);
  if (values.requete) {
    const validation = await validerSql(values.requete);
    console.log(`Validation : ${validation.ok ? "acceptée" : `REFUSÉE, ${validation.raison}`}`);
    // Même refusée, on l'envoie à la base pour montrer qu'elle tient aussi seule (la démonstration le dit)
    try {
      console.log(`Base :\n${enTexte(await executerEnLecture(pool, values.requete, matricule))}`);
    } catch (e) {
      console.log(`Base : REFUSÉE, ${(e as Error).message}`);
    }
  } else {
    const r = await interroger(creerLlm(), pool, positionals[0], matricule);
    console.log(`Requête (${r.essais} essai(s)) :\n  ${r.sql.replace(/\n/g, "\n  ")}`);
    console.log(r.resultat ? `Résultat :\n${enTexte(r.resultat)}` : `Échec : ${r.erreur}`);
    console.log(`Tokens : ${r.usage.entree} en entrée, dont ${r.usage.enCache} relus dans le cache ; ${r.usage.sortie} en sortie`);
  }
} finally {
  await pool.end();
}
