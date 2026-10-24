// Les désaccords entre deux juges (chapitre 14, leçon 4), et leur fiabilité mesurée contre les étiquettes humaines.
// Deux exécutions des mêmes réponses (npm run eval:rejuger) : chaque question où les verdicts diffèrent s'affiche, avec les
// raisons de chaque juge, pour qu'un humain tranche (dans l'interface, vue Évaluations, ou avec --etiqueter).
// Lancement : npm run eval:desaccords -- <exécution A> <exécution B>
//             npm run eval:desaccords -- <A> <B> --etiqueter Q20 --reussie oui --raison "la Toussaint tombe un dimanche"
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { desaccords, etiqueter, fiabilite, lireEtiquettes, scoreVerifie } from "../eval/etiquettes.ts";
import type { Execution } from "../eval/production.ts";
import { aujourdhui } from "../recherche/passages.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { etiqueter: { type: "string" }, reussie: { type: "string" }, raison: { type: "string" } },
});
const [nomA, nomB] = positionals;
if (!nomA || !nomB || ![nomA, nomB].every((n) => /^[\w-][\w.-]*$/.test(n))) throw new Error("Attendu : deux noms d'exécution");
const lire = async (nom: string) => JSON.parse(await readFile(`eval/production/resultats/${nom}/execution.json`, "utf8")) as Execution;
const [a, b] = [await lire(nomA), await lire(nomB)];
const liste = desaccords(a, b);

// Une décision humaine : sur une question en désaccord, la réponse est-elle réussie ?
if (values.etiqueter) {
  const d = liste.find((x) => x.id === values.etiqueter);
  if (!d) throw new Error(`${values.etiqueter} n'est pas en désaccord entre ces deux exécutions`);
  if (!["oui", "non"].includes(values.reussie ?? "") || !values.raison) throw new Error("Attendu : --reussie oui|non --raison « pourquoi »");
  await etiqueter({ id: d.id, reponse: d.empreinte, reussie: values.reussie === "oui", raison: values.raison, date: aujourdhui() });
  console.log(`${d.id} étiquetée : ${values.reussie === "oui" ? "réussie" : "échouée"}`);
}

const etiquettes = await lireEtiquettes();
const etiquetees = new Set(etiquettes.map((e) => `${e.id} ${e.reponse}`));
console.log(`${liste.length} désaccord(s) entre ${a.configuration.juge} (${nomA}) et ${b.configuration.juge} (${nomB})\n`);
for (const d of liste) {
  const fait = etiquetees.has(`${d.id} ${d.empreinte}`) ? "  [étiquetée]" : "";
  console.log(`${d.id}${fait}  A : ${String(d.a)}  B : ${String(d.b)}  « ${d.question} »`);
  console.log(`   Rhéa : ${d.reponse.replace(/\s+/g, " ").slice(0, 240)}`);
  for (const r of d.raisonsA) console.log(`   A, ${r.slice(0, 200)}`);
  for (const r of d.raisonsB) console.log(`   B, ${r.slice(0, 200)}`);
}
const taux = (x: number | null) => (x === null ? "-" : `${(100 * x).toFixed(0)} %`);
for (const [nom, e] of [[nomA, a], [nomB, b]] as const) {
  const f = fiabilite(e, etiquettes);
  console.log(`\n${nom} (${e.configuration.juge}) contre ${f.etiquetees} étiquette(s) : réponses justes reconnues ${taux(f.sensibilite)} (${f.positifs}), fausses attrapées ${taux(f.specificite)} (${f.negatifs})`);
}
const s = scoreVerifie(a, b, etiquettes);
console.log(`\nScore vérifié : ${s.reussies} réussies sur ${s.total} (étiquette humaine, sinon accord des deux juges), ${s.aTrancher} désaccord(s) encore à trancher`);
