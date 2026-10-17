// Parcourir l'organigramme de Kalyo dans le terminal : la chaîne hiérarchique d'une personne et son équipe, ou la
// vérification du graphe (direction, managers inconnus, boucles). Sans LLM.
// Lancement : npm run organigramme -- ["prénom nom"] [--matricule K0042] [--verifier]
import { parseArgs } from "node:util";
import { pool } from "../db.ts";
import { chaine, equipe, nomComplet, trouver, verifier, type Personne } from "../graphe/organigramme.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { matricule: { type: "string" }, verifier: { type: "boolean", default: false } },
});
const decrire = (p: Personne) => `${nomComplet(p)} (${p.matricule}) : ${p.poste}, ${p.service}`;

try {
  if (values.verifier) {
    const v = await verifier(pool);
    console.log(`Direction (personnes sans manager) : ${v.racines.length}`);
    for (const p of v.racines) console.log(`  - ${decrire(p)}`);
    console.log(`Managers inconnus de la table : ${v.managersInconnus.length === 0 ? "aucun" : v.managersInconnus.map(decrire).join(" ; ")}`);
    console.log(`Boucles : ${v.boucles.length === 0 ? "aucune" : v.boucles.map((b) => b.join(" → ")).join(" ; ")}`);
  } else {
    let matricule = values.matricule?.toUpperCase();
    if (positionals[0]) {
      const trouvees = await trouver(pool, positionals[0]);
      if (trouvees.length !== 1) {
        console.error(trouvees.length === 0 ? `Personne ne s'appelle « ${positionals[0]} ».` : `Plusieurs personnes : ${trouvees.map(decrire).join(" ; ")}`);
        process.exit(1);
      }
      matricule = trouvees[0].matricule;
    }
    if (!matricule || !/^K\d{4}$/.test(matricule)) {
      console.error("Attendu : un nom entre guillemets, ou --matricule au format K0042");
      process.exit(1);
    }
    const liste = await chaine(pool, matricule);
    if (liste.length === 0) {
      console.error(`Aucun salarié n'a le matricule ${matricule}.`);
      process.exit(1);
    }
    // De la direction jusqu'à la personne, un cran de retrait par niveau
    console.log("Chaîne hiérarchique :");
    for (const [i, p] of [...liste].reverse().entries()) console.log(`${"  ".repeat(i + 1)}${decrire(p)}`);
    const { directs, total } = await equipe(pool, matricule);
    if (directs.length > 0) {
      console.log(`\nÉquipe directe : ${directs.length} personnes (en tout, ${total} dépendent de ${nomComplet(liste[0])})`);
      for (const p of directs) console.log(`  - ${decrire(p)}`);
    }
  }
} finally {
  await pool.end();
}
