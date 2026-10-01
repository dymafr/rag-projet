// Tests du découpage. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Document } from "../src/ingestion/document.ts";
import { decouperFixe } from "../src/decoupage/fixe.ts";
import { enCaracteres } from "../src/decoupage/mesure.ts";
import { blocs, decouperDocument, redecouper, sections } from "../src/decoupage/structure.ts";

const phrase = "Un repas avec un client est remboursé dans la limite de 45 euros à Paris.";

test("à taille fixe, chaque chunk tient dans la taille et aucun mot n'est coupé", () => {
  assert.deepEqual(decouperFixe(phrase, 20), ["Un repas avec un", "client est", "remboursé dans la", "limite de 45 euros", "à Paris."]);
});

test("avec un chevauchement, chaque chunk reprend la fin du précédent", () => {
  assert.deepEqual(decouperFixe(phrase, 30, 10), [
    "Un repas avec un client est",
    "est remboursé dans la limite",
    "la limite de 45 euros à",
    "euros à Paris.",
  ]);
});

test("la taille se mesure aussi en tokens : il suffit de changer de mesure", () => {
  const mots = (texte: string) => texte.trim().split(/\s+/).length; // une mesure jouet : un token par mot
  assert.deepEqual(decouperFixe(phrase, 5, 0, mots), ["Un repas avec un client", "est remboursé dans la limite", "de 45 euros à Paris."]);
});

const guide = [
  "# Guide du développeur",
  "## Installer",
  "Lancez la commande suivante.",
  "",
  "```bash",
  "# installe les dépendances",
  "npm install",
  "",
  "npm test",
  "```",
  "## Configurer",
  "### Le fichier .env",
  "Copiez .env.example en .env.",
].join("\n");

test("les sections suivent les titres, pas les commentaires d'un bloc de code", () => {
  assert.deepEqual(
    sections(guide).map((section) => section.titres),
    [
      ["Guide du développeur", "Installer"],
      ["Guide du développeur", "Configurer", "Le fichier .env"],
    ],
  );
});

test("un bloc de code reste entier, même avec une ligne vide", () => {
  assert.deepEqual(blocs(sections(guide)[0].corps), ["Lancez la commande suivante.", "```bash\n# installe les dépendances\nnpm install\n\nnpm test\n```"]);
});

test("un paragraphe trop grand est redécoupé aux fins de phrase", () => {
  const paragraphe = "Le train se prend en 2de classe. La 1re classe est remboursée si elle coûte moins cher. Réservez tôt.";
  assert.deepEqual(
    redecouper(paragraphe, 70, enCaracteres).map((morceau) => morceau.trim()),
    ["Le train se prend en 2de classe.", "La 1re classe est remboursée si elle coûte moins cher. Réservez tôt."],
  );
});

const doc = (id: string, texte: string): Document => ({
  id,
  source: `${id}.pdf`,
  titre: "Politique de test",
  texte,
  metadonnees: { id, titre: "Politique de test", type: "politique", date_effet: "2026-01-01", acces: "tous", langue: "fr", site: ["lyon"] },
});

test("un chunk ne mélange jamais deux sections et tient dans la taille", () => {
  const texte = "# Politique de test\n## Article 1. Objet\nPremier paragraphe.\n\nDeuxième paragraphe.\n## Article 2. Repas\nVingt euros.";
  const chunks = decouperDocument(doc("POL-XX-01", texte), 100, enCaracteres);
  assert.deepEqual(
    chunks.map((chunk) => [chunk.id, chunk.titres.at(-1), chunk.texte]),
    [
      ["POL-XX-01#1", "Article 1. Objet", "Premier paragraphe.\n\nDeuxième paragraphe."],
      ["POL-XX-01#2", "Article 2. Repas", "Vingt euros."],
    ],
  );
  assert.ok(chunks.every((chunk) => chunk.taille <= 100));
  // un texte sans titre, comme un ticket : rattaché au titre du document
  const ticket = decouperDocument(doc("TK-1", "Question : où poser un CP ?"), 100, enCaracteres);
  assert.deepEqual(ticket.map((chunk) => chunk.titres), [["Politique de test"]]);
});
