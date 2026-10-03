// Enregistrer les exemples des tests de recherche : quelques chunks et quelques questions, avec leurs vecteurs,
// calculés une fois par le modèle du projet. Les tests relisent ce fichier : ni Docker, ni modèle à charger.
// Lancement : npm run enregistrer (réécrit test/exemples/recherche.json ; à relancer si le modèle ou le découpage change)
import { writeFile } from "node:fs/promises";
import { texteAVectoriser } from "../decoupage/contexte.ts";
import { lireChunks, lireDocuments } from "../decoupage/corpus.ts";
import { nomDuModele, vectoriser } from "../embeddings/fournisseurs.ts";
import { dateDeFin } from "../stockage/chunks.ts";

// Le télétravail (l'accord, son avenant, la FAQ), les repas et l'hôtel (FAQ, politique, tickets de Lyon et de Nantes),
// deux passages en anglais
const IDS = [
  "FAQ-RH#2", "POL-TTG-01#3", "POL-TT-02#10", "POL-TT-01#8", "INT-ACTUALITES#5",
  "FAQ-RH#19", "FAQ-RH#20", "FAQ-RH#21", "POL-NF-01#8", "TK-2026-0048#1", "TK-2026-0071#1", "TK-2026-0007#1", "TK-2026-0027#1",
  "GRP-TRV-01#16", "GRP-TRV-01#2",
];
const QUESTIONS = [
  "Combien de jours de télétravail par semaine ?",
  "Quel est le plafond pour un repas avec un client à Lyon ?",
];
const arrondir = (vecteur: number[]) => vecteur.map((x) => Math.round(x * 1e6) / 1e6); // 6 décimales suffisent

const documents = new Map((await lireDocuments()).map((document) => [document.id, document]));
const chunks = (await lireChunks()).filter((chunk) => IDS.includes(chunk.id));
const absents = IDS.filter((id) => !chunks.some((chunk) => chunk.id === id));
if (absents.length > 0) throw new Error(`Chunks introuvables dans donnees/chunks.jsonl : ${absents.join(", ")}`);

const vecteurs = await vectoriser(chunks.map(texteAVectoriser), "document");
const questions = await vectoriser(QUESTIONS, "requete");
const exemples = {
  modele: nomDuModele(),
  questions: Object.fromEntries(QUESTIONS.map((question, i) => [question, arrondir(questions[i])])),
  chunks: chunks.map((chunk, i) => {
    const document = documents.get(chunk.document)!;
    // le texte entier du document ne sert pas aux tests : seules ses métadonnées comptent
    return { chunk, document: { ...document, texte: "" }, dateFin: dateDeFin(document, documents), vecteur: arrondir(vecteurs[i]) };
  }),
};
await writeFile("test/exemples/recherche.json", `${JSON.stringify(exemples)}\n`);
console.log(`test/exemples/recherche.json : ${chunks.length} chunks et ${QUESTIONS.length} questions vectorisés avec ${exemples.modele}`);
