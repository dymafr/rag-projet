// Tests de la diversité : MMR et fusion des passages voisins, avec des vecteurs écrits à la main. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { fusionnerVoisins, idsDuPassage, mmr } from "../src/recherche/diversite.ts";
import type { Resultat } from "../src/recherche/vectorielle.ts";

const passage = (id: string, score = 0.5): Resultat => ({ id, document: id.split("#")[0], titres: [id], texte: `texte de ${id}`, score });
const ids = (resultats: Resultat[]) => resultats.map((r) => r.id);

test("MMR : un passage presque identique à un passage déjà choisi cède sa place à un passage différent", () => {
  // A et A2 sont presque identiques et classés en tête ; B, troisième, est différent
  const candidats = [
    { ...passage("A#1"), vecteur: [1, 0] },
    { ...passage("A2#1"), vecteur: [0.999, 0.045] },
    { ...passage("B#1"), vecteur: [0, 1] },
  ];
  assert.deepEqual(ids(mmr(candidats, 2, 1)), ["A#1", "A2#1"]); // lambda = 1 : la liste telle quelle
  // lambda = 0,7, au second tour : A2 vaut 0,7 × 2/3 − 0,3 × 0,999 = 0,167 ; B vaut 0,7 × 1/3 − 0,3 × 0 = 0,233
  assert.deepEqual(ids(mmr(candidats, 2, 0.7)), ["A#1", "B#1"]);
  assert.ok(!("vecteur" in mmr(candidats, 1, 0.7)[0])); // les vecteurs ne sortent pas de mmr
});

test("MMR : la pertinence vient du rang dans la liste reçue, pas du score", () => {
  // Après une fusion hybride, le premier peut avoir une similarité plus basse que le second : MMR garde l'ordre reçu
  const candidats = [
    { ...passage("L#1", 0.45), vecteur: [1, 0] },
    { ...passage("V#1", 0.72), vecteur: [0, 1] },
  ];
  assert.deepEqual(ids(mmr(candidats, 2, 1)), ["L#1", "V#1"]);
});

test("fusion des voisins : deux morceaux qui se suivent ne font plus qu'un, à la place du mieux classé", () => {
  const fusion = fusionnerVoisins([passage("CA#17", 0.8), passage("NF#3", 0.7), passage("CA#16", 0.6), passage("CA#19", 0.5)]);
  assert.deepEqual(ids(fusion), ["CA#16+17", "NF#3", "CA#19"]); // CA#19 n'est pas le voisin de CA#17 (il manque CA#18)
  assert.equal(fusion[0].texte, "texte de CA#16\n\ntexte de CA#17"); // dans l'ordre du document
  assert.equal(fusion[0].score, 0.8);
  assert.deepEqual(idsDuPassage("CA#16+17"), ["CA#16", "CA#17"]);
  assert.deepEqual(idsDuPassage("POL-NF-01#4"), ["POL-NF-01#4"]);
});

test("fusion des voisins : un identifiant sans position (GUIDE, CA#16+17) reste tel quel", () => {
  assert.deepEqual(ids(fusionnerVoisins([passage("GUIDE"), passage("CA#16+17"), passage("CA#18")])), ["GUIDE", "CA#16+17", "CA#18"]);
});
