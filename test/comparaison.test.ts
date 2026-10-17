// Tests de la comparaison des systèmes (chapitre 11, leçon 4) : centiles et coût d'une question. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { centile, cout, type Tarifs } from "../src/eval/comparaison.ts";

test("centile prend la valeur sous laquelle se trouvent p % des mesures, sans interpoler", () => {
  const durees = [4.1, 2.0, 3.5, 9.8, 3.0, 2.5, 3.2, 2.8, 3.9, 30.2];
  assert.equal(centile(durees, 50), 3.2); // la 5e des 10 valeurs triées
  assert.equal(centile(durees, 95), 30.2); // la 10e : une seule question lente pèse sur le 95e centile, pas sur la médiane
  assert.equal(centile([7], 95), 7);
  assert.equal(centile([], 50), 0);
});

const tarifs: Tarifs = {
  date: "2026-10-16",
  source: "https://example.com/prix",
  modeles: { "openai modele-test": { entree: 0.1, enCache: 0.01, ecritureCache: 0.125, sortie: 0.5 } },
  fileSearchPour1000: 2.5,
};

test("cout compte les tokens relus dans le cache à leur prix, et chaque appel de file_search", () => {
  // 10 000 tokens d'entrée dont 4 000 relus dans le cache et 1 000 écrits, 200 en sortie, un appel de file_search
  const c = cout({ entree: 10_000, enCache: 4_000, sortie: 200, ecritCache: 1_000 }, 1, "openai modele-test", tarifs)!;
  const attendu = (6_000 * 0.1 + 4_000 * 0.01 + 200 * 0.5 + 1_000 * (0.125 - 0.1)) / 1_000_000 + 2.5 / 1000;
  assert.ok(Math.abs(c.min - attendu) < 1e-12);
  assert.equal(c.max, c.min); // l'écriture est connue : le coût est exact
  assert.ok(2.5 / 1000 > c.min - 2.5 / 1000); // ici, l'appel de l'outil coûte plus que tous les tokens
});

test("cout rend une fourchette quand la trace ne dit pas combien de tokens ont été écrits dans le cache", () => {
  const c = cout({ entree: 10_000, enCache: 4_000, sortie: 200 }, 0, "openai modele-test", tarifs)!;
  const sansEcriture = (6_000 * 0.1 + 4_000 * 0.01 + 200 * 0.5) / 1_000_000;
  assert.ok(Math.abs(c.min - sansEcriture) < 1e-12);
  assert.ok(Math.abs(c.max - (sansEcriture + (6_000 * (0.125 - 0.1)) / 1_000_000)) < 1e-12); // toute l'entrée non relue écrite
});

test("cout rend null pour un modèle sans tarif, comme le modèle local", () => {
  assert.equal(cout({ entree: 2_000, enCache: 0, sortie: 100 }, 0, "ollama modele-local", tarifs), null);
});
