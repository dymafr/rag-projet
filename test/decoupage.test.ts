// Tests du découpage. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { decouperFixe } from "../src/decoupage/fixe.ts";

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
