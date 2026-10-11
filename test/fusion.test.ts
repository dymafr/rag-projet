// Tests de la fusion par les rangs (RRF), sur des exemples calculés à la main. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { fusionner, K_RRF } from "../src/recherche/fusion.ts";

test("RRF : un passage bien classé dans les deux listes passe devant un premier d'une seule liste", () => {
  // A : 1/61 + 1/62 = 0,03252 ; C : 1/63 + 1/61 = 0,03227 ; B : 1/62 = 0,01613 ; D : 1/63 = 0,01587
  assert.deepEqual(fusionner([["A", "B", "C"], ["C", "A", "D"]]), ["A", "C", "B", "D"]);
  assert.equal(K_RRF, 60);
});

test("RRF : seuls les rangs comptent, et le poids d'une liste change l'équilibre", () => {
  // B : 1/62 + 1/62 = 0,03226 ; A et X : 1/61 = 0,01639 chacun, à égalité : A, cité par la première liste, passe devant
  assert.deepEqual(fusionner([["A", "B"], ["X", "B"]]), ["B", "A", "X"]);
  // Sans poids, X (premier de la seconde liste) passe devant B (second de la première) : 1/61 contre 1/62. Avec un poids
  // de 0,5 pour la seconde liste, X ne vaut plus que 0,5/61 = 0,0082 et passe derrière B
  assert.deepEqual(fusionner([["A", "B"], ["X", "A"]]), ["A", "X", "B"]);
  assert.deepEqual(fusionner([["A", "B"], ["X", "A"]], [1, 0.5]), ["A", "B", "X"]);
  assert.deepEqual(fusionner([["A"], ["X"]], [1, 0.5]), ["A", "X"]);
  assert.deepEqual(fusionner([["A"], ["X"]], [0.5, 1]), ["X", "A"]);
});

test("RRF : une liste vide ne change rien, et deux listes vides donnent une liste vide", () => {
  assert.deepEqual(fusionner([["A", "B"], []]), ["A", "B"]);
  assert.deepEqual(fusionner([[], []]), []);
});
