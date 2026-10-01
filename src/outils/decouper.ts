// Découper le corpus en chunks, ou un seul document pour voir où tombent les coupures
// Lancement : npm run decouper (tout le corpus, écrit donnees/chunks.jsonl)
//             npm run decouper -- POL-NF-01 (un document ; --strategie fixe, --taille, --chevauchement, --unite caracteres)
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { config } from "../config.ts";
import type { Chunk } from "../decoupage/chunk.ts";
import { lireDocuments } from "../decoupage/corpus.ts";
import { decouperFixe } from "../decoupage/fixe.ts";
import { enCaracteres, mesureDuModele } from "../decoupage/mesure.ts";
import { decouperDocument } from "../decoupage/structure.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    strategie: { type: "string", default: "structure" }, // structure ou fixe
    taille: { type: "string", default: "300" },
    chevauchement: { type: "string", default: "0" },
    unite: { type: "string", default: "tokens" }, // tokens ou caracteres
  },
});
const taille = Number(values.taille);
const chevauchement = Number(values.chevauchement);

// La mesure : les tokens du modèle d'embedding, ou les caractères
const modele = values.unite === "caracteres" ? { mesure: enCaracteres, limite: Infinity, estimee: false } : await mesureDuModele(config);
const unite = values.unite === "caracteres" ? "caractères" : modele.estimee ? "tokens (estimés)" : "tokens";
const apercu = (texte: string) => texte.replace(/\n+/g, " ↵ ");
const documents = await lireDocuments();

if (positionals[0]) {
  // Un document : chaque chunk, avec son début et sa fin
  const document = documents.find((d) => d.id === positionals[0]);
  if (!document) throw new Error(`Document inconnu : ${positionals[0]}`);
  const tailleDocument = modele.mesure(document.texte);
  console.log(`${document.id} « ${document.titre} » : ${tailleDocument} ${unite}`);
  if (tailleDocument > modele.limite) console.log(`Le modèle d'embedding lit au plus ${modele.limite} tokens : le reste du document serait ignoré.`);

  if (values.strategie === "fixe") {
    const chunks = decouperFixe(document.texte, taille, chevauchement, modele.mesure);
    console.log(`\nTaille fixe : ${taille} ${unite}, chevauchement ${chevauchement}`);
    chunks.forEach((chunk, i) => {
      console.log(`#${i + 1}  ${modele.mesure(chunk)} ${unite}  « ${apercu(chunk.slice(0, 45))}… »  …  « …${apercu(chunk.slice(-45))} »`);
    });
    const total = chunks.reduce((somme, chunk) => somme + modele.mesure(chunk), 0);
    const surcout = Math.round((100 * (total - tailleDocument)) / tailleDocument);
    console.log(`\n${chunks.length} chunks, ${total} ${unite} au total pour un document de ${tailleDocument} (${surcout >= 0 ? "+" : ""}${surcout} %)`);
  } else {
    const chunks = decouperDocument(document, taille, modele.mesure);
    console.log(`\nDécoupage structurel : ${taille} ${unite} au plus`);
    for (const chunk of chunks) {
      console.log(`${chunk.id}  ${chunk.taille} ${unite}  [${chunk.titres.slice(1).join(" > ")}]`);
      console.log(`   « ${apercu(chunk.texte.slice(0, 60))}… »  …  « …${apercu(chunk.texte.slice(-40))} »`);
    }
    console.log(`\n${chunks.length} chunks`);
  }
} else {
  // Tout le corpus : les chunks de chaque document, écrits dans donnees/chunks.jsonl
  const debut = performance.now();
  const chunks: Chunk[] = documents.flatMap((document) => decouperDocument(document, taille, modele.mesure));
  await writeFile("donnees/chunks.jsonl", chunks.map((chunk) => `${JSON.stringify(chunk)}\n`).join(""));
  const tailles = chunks.map((chunk) => chunk.taille).sort((a, b) => a - b);
  console.log(`${documents.length} documents, ${chunks.length} chunks écrits dans donnees/chunks.jsonl en ${((performance.now() - debut) / 1000).toFixed(1)} s`);
  console.log(`Taille des chunks (${unite}) : ${tailles[0]} au plus petit, ${tailles[tailles.length >> 1]} en médiane, ${tailles[tailles.length - 1]} au plus grand`);
  const tropGrands = chunks.filter((chunk) => chunk.taille > taille);
  console.log(`Au-dessus de ${taille} : ${tropGrands.length}${tropGrands.map((chunk) => ` ${chunk.id}`).join("")}`);
}
