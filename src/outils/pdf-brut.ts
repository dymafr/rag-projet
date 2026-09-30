// Ce que contient vraiment une page de PDF : le texte brut, puis les lignes avec leur position et leur taille
// Lancement : npm run pdf:brut -- corpus/politiques/POL-NF-01.pdf 2
import { readFile } from "node:fs/promises";
import { extractText, getDocumentProxy } from "unpdf";
import { lirePdf } from "../ingestion/pdf.ts";

const chemin = process.argv[2] ?? "corpus/politiques/POL-NF-01.pdf";
const numero = Number(process.argv[3] ?? 1);

// 1. L'extraction la plus simple : tout le texte de la page, dans l'ordre où le PDF le range
const pdf = await getDocumentProxy(new Uint8Array(await readFile(chemin)));
const { text } = await extractText(pdf, { mergePages: false });
console.log(`--- Texte brut de la page ${numero}\n${text[numero - 1]}`);

// 2. Les lignes reconstruites : ordonnée, taille de police, puis chaque groupe de mots avec son abscisse
const pages = await lirePdf(chemin);
console.log(`\n--- Lignes de la page ${numero} (y, taille, [x] texte)`);
for (const { y, taille, morceaux } of pages[numero - 1]) {
  const groupes = morceaux.map((m) => `[${Math.round(m.x)}] ${m.texte}`).join("  ");
  console.log(`${Math.round(y).toString().padStart(4)}  ${taille.toString().padEnd(4)}  ${groupes}`);
}
