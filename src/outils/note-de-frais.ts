// Lire une note de frais scannée avec le modèle de vision, puis la contrôler : somme des lignes, champs illisibles,
// plafonds de la politique notes de frais. Une aide à la relecture, pas une validation.
// Lancement : npm run note-de-frais -- corpus/formulaires/NDF-03-K0101-2026-10.jpg [--matricule K0101] [--date 2026-10-17]
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { z } from "zod";
import { CONSIGNE_NOTE, controler, NoteDeFrais } from "../vision/note-de-frais.ts";
import { aujourdhui } from "../recherche/passages.ts";
import { regarder } from "../vision/regarder.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { matricule: { type: "string" }, date: { type: "string", default: aujourdhui() } },
});
const chemin = positionals[0];
if (!chemin || !/^\d{4}-\d{2}-\d{2}$/.test(values.date) || (values.matricule !== undefined && !/^K\d{4}$/.test(values.matricule))) {
  console.error("Attendu : le chemin d'une image (corpus/formulaires/NDF-03-K0101-2026-10.jpg), --date AAAA-MM-JJ, --matricule K0101");
  process.exit(1);
}
const { $schema, ...schema } = z.toJSONSchema(NoteDeFrais); // le format de sortie imposé au modèle
const debut = performance.now();
const brut = await regarder(await readFile(chemin), CONSIGNE_NOTE, schema);
let json: unknown = null;
try {
  json = JSON.parse(brut);
} catch {} // une réponse vide ou tronquée : signalée juste en dessous, avec la sortie brute
const lu = NoteDeFrais.safeParse(json);
if (!lu.success) {
  console.error(`Lecture non conforme au schéma :\n${z.prettifyError(lu.error)}\n${brut}`);
  process.exit(1);
}
const note = lu.data;
const montant = (n: number | null) => (n === null ? "illisible" : n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" }));
console.log(`Lue en ${((performance.now() - debut) / 1000).toFixed(1)} s : ${note.prenom ?? "?"} ${note.nom ?? "?"} (${note.matricule ?? "matricule illisible"}), ${note.objet ?? "objet illisible"}`);
for (const l of note.lignes) console.log(`  ${l.date ?? "date ?"}  ${(l.nature ?? "?").padEnd(10)} ${(l.detail ?? "").padEnd(28)} ${montant(l.montant)}`);
console.log(`  Total écrit : ${montant(note.total)}`);
const controles = controler(note, { date: values.date, matricule: values.matricule });
console.log(controles.length === 0 ? "\nContrôles : rien à signaler." : "\nContrôles :");
for (const c of controles) console.log(`  [${c.niveau}] ${c.texte}`);
console.log("\nÀ relire sur l'image avant de valider : la lecture d'un chiffre manuscrit peut être fausse.");
