// Tests des mesures de similarité. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { cosinus, distance, norme, normaliser, produitScalaire } from "../src/embeddings/similarite.ts";

// Les calculs à virgule flottante ne tombent pas toujours juste : on compare à 1e-9 près
const proche = (obtenu: number, attendu: number) => Math.abs(obtenu - attendu) < 1e-9;

test("le cosinus vaut 1, 0 ou -1 selon l'angle", () => {
  assert.ok(proche(cosinus([1, 2], [2, 4]), 1)); // même direction, longueurs différentes
  assert.ok(proche(cosinus([1, 0], [0, 3]), 0)); // angle droit
  assert.ok(proche(cosinus([1, 1], [-2, -2]), -1)); // directions opposées
});

test("le produit scalaire dépend de la longueur, pas le cosinus", () => {
  assert.equal(produitScalaire([1, 2], [3, 4]), 11);
  assert.equal(produitScalaire([10, 20], [3, 4]), 110);
  assert.ok(proche(cosinus([10, 20], [3, 4]), cosinus([1, 2], [3, 4])));
});

test("sur des vecteurs normalisés, produit scalaire et cosinus sont égaux", () => {
  const [a, b] = [normaliser([3, 4]), normaliser([4, 3])];
  assert.ok(proche(norme(a), 1));
  assert.ok(proche(produitScalaire(a, b), cosinus(a, b)));
  // et la distance se déduit du cosinus : d² = 2 - 2 cos
  assert.ok(proche(distance(a, b) ** 2, 2 - 2 * cosinus(a, b)));
});

test("des vecteurs de dimensions différentes sont refusés", () => {
  assert.throws(() => produitScalaire([1, 2, 3], [1, 2]), /dimensions différentes/);
  assert.throws(() => distance([1, 2], [1, 2, 3]), /dimensions différentes/);
});

test("un vecteur nul n'a pas de direction", () => {
  assert.throws(() => normaliser([0, 0]), /vecteur nul/);
  assert.throws(() => cosinus([0, 0], [1, 1]), /vecteur nul/);
});
