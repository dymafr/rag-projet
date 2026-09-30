// Tout le corpus au format commun : les documents par dossier, les doublons écartés, un document en exemple
// Lancement : npm run documents -- TK-2026-0038
import { basename, dirname } from "node:path";
import { charger, listerFichiers } from "../ingestion/chargeurs.ts";
import { dedoublonner } from "../ingestion/document.ts";

const documents = (await Promise.all((await listerFichiers()).map(charger))).flat();
const { uniques, doublons } = dedoublonner(documents);

// 1. Les documents, par dossier d'origine
const ligne = (a: string, b: number | string, c: number | string) => `${a.padEnd(11)} ${String(b).padStart(9)} ${String(c).padStart(11)}`;
console.log(ligne("Dossier", "Documents", "Caractères"));
const parDossier = Object.groupBy(uniques, (d) => basename(dirname(d.source)));
for (const [dossier, liste = []] of Object.entries(parDossier)) {
  console.log(ligne(dossier, liste.length, liste.reduce((total, d) => total + d.texte.length, 0)));
}
console.log(ligne("Total", uniques.length, uniques.reduce((total, d) => total + d.texte.length, 0)));

// 2. Les doublons : même empreinte, donc même texte
for (const { doublon, original } of doublons) console.log(`Doublon écarté : ${doublon.source} (même texte que ${original.source})`);
if (doublons.length === 0) console.log("Aucun doublon");

// 3. Un document au format commun (texte abrégé)
const exemple = uniques.find((d) => d.id === (process.argv[2] ?? "POL-NF-01"));
if (exemple) console.log(JSON.stringify({ ...exemple, texte: `${exemple.texte.slice(0, 200)}…` }, null, 2));
