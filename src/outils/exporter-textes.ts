// Écrire le texte extrait de chaque document (chapitre 4) dans un fichier Markdown, donnees/textes/<id>.md : le corpus
// tel qu'un agent de code le verrait, des fichiers à lister, parcourir et lire (leçon 7). Seuls les documents ouverts à
// tous les salariés sont écrits, ce que Rhéa cherche pour un salarié ; les versions remplacées aussi, avec leurs dates
// Lancement : npm run textes (après npm run ingest)
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
const DOSSIER_TEXTES = "donnees/textes"; // le dossier que lisent les outils de src/agent/fichiers.ts

type Metadonnees = { type: string; acces: string; date_effet?: string; remplace?: string; remplace_par?: string };
type Document = { id: string; titre: string; texte: string; metadonnees: Metadonnees };

const lignes = (await readFile("donnees/documents.jsonl", "utf8")).split("\n").filter(Boolean);
const documents = lignes.map((l) => JSON.parse(l) as Document).filter((d) => d.metadonnees.acces === "tous");
await rm(DOSSIER_TEXTES, { recursive: true, force: true });
await mkdir(DOSSIER_TEXTES, { recursive: true });
for (const d of documents) {
  // Une ligne d'en-tête dit de quoi il s'agit, depuis quand le texte s'applique et s'il a été remplacé : un fichier n'a
  // pas d'autres métadonnées, et grep ne sait pas qu'un accord de 2024 ne vaut plus
  const { type, date_effet, remplace, remplace_par } = d.metadonnees;
  const periode = date_effet ? ` · en vigueur depuis le ${date_effet}` : "";
  const versions = (remplace ? ` · remplace ${remplace}` : "") + (remplace_par ? ` · REMPLACÉ PAR ${remplace_par}` : "");
  await writeFile(join(DOSSIER_TEXTES, `${d.id}.md`), `<!-- ${d.id} · ${type}${periode}${versions} -->\n${d.texte.trim()}\n`);
}
console.log(`${documents.length} fichiers écrits dans ${DOSSIER_TEXTES} (${lignes.length - documents.length} documents réservés écartés)`);
