// Découper un document du corpus et voir où tombent les coupures
// Lancement : npm run decouper -- POL-NF-01 --taille 300 --chevauchement 50 (ou --unite caracteres)
import { parseArgs } from "node:util";
import { config } from "../config.ts";
import { lireDocuments } from "../decoupage/corpus.ts";
import { decouperFixe } from "../decoupage/fixe.ts";
import { enCaracteres, mesureDuModele } from "../decoupage/mesure.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    taille: { type: "string", default: "300" },
    chevauchement: { type: "string", default: "0" },
    unite: { type: "string", default: "tokens" }, // tokens ou caracteres
  },
});
const taille = Number(values.taille);
const chevauchement = Number(values.chevauchement);

const id = positionals[0] ?? "POL-NF-01";
const document = (await lireDocuments()).find((d) => d.id === id);
if (!document) throw new Error(`Document inconnu : ${id}`);

// La mesure : les tokens du modèle d'embedding, ou les caractères
const modele = values.unite === "caracteres" ? { mesure: enCaracteres, limite: Infinity, estimee: false } : await mesureDuModele(config);
const unite = values.unite === "caracteres" ? "caractères" : modele.estimee ? "tokens (estimés)" : "tokens";
const tailleDocument = modele.mesure(document.texte);
console.log(`${document.id} « ${document.titre} » : ${tailleDocument} ${unite}`);
if (tailleDocument > modele.limite) console.log(`Le modèle d'embedding lit au plus ${modele.limite} tokens : le reste du document serait ignoré.`);

// Les chunks, avec leur début et leur fin : on voit où tombent les coupures
const chunks = decouperFixe(document.texte, taille, chevauchement, modele.mesure);
const apercu = (texte: string) => texte.replace(/\n+/g, " ↵ ");
console.log(`\nTaille fixe : ${taille} ${unite}, chevauchement ${chevauchement}`);
chunks.forEach((chunk, i) => {
  console.log(`#${i + 1}  ${modele.mesure(chunk)} ${unite}  « ${apercu(chunk.slice(0, 45))}… »  …  « …${apercu(chunk.slice(-45))} »`);
});
const total = chunks.reduce((somme, chunk) => somme + modele.mesure(chunk), 0);
const surcout = Math.round((100 * (total - tailleDocument)) / tailleDocument);
console.log(`\n${chunks.length} chunks, ${total} ${unite} au total pour un document de ${tailleDocument} (${surcout >= 0 ? "+" : ""}${surcout} %)`);
