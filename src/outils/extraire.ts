// Affiche le texte extrait d'un fichier du corpus, en Markdown
// Lancement : npm run extraire -- corpus/intranet/qui-contacter.html
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { htmlVersMarkdown } from "../ingestion/html.ts";
import { separerEntete } from "../ingestion/markdown.ts";

// Chaque format a son extracteur ; tous rendent du Markdown
async function extraire(chemin: string): Promise<string> {
  switch (extname(chemin)) {
    case ".html":
      return htmlVersMarkdown(await readFile(chemin, "utf8"));
    case ".md":
      return separerEntete(await readFile(chemin, "utf8")).texte;
    default:
      throw new Error(`${chemin} : format non pris en charge`);
  }
}

const chemin = process.argv[2] ?? "corpus/intranet/qui-contacter.html";
try {
  const { size } = await stat(chemin);
  const texte = await extraire(chemin);
  console.log(texte);
  console.log(`\nFichier de ${size} octets, ${texte.length} caractères extraits`);
} catch (erreur) {
  console.error((erreur as Error).message);
  process.exitCode = 1;
}
