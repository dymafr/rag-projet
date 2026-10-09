// Tests de la requête de recherche vectorielle, sans base : le SQL produit et ses valeurs. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { requete } from "../src/recherche/vectorielle.ts";

test("requete trie sur la distance à la question, sans WHERE quand il n'y a pas de filtre", () => {
  const { sql, valeurs } = requete([0.6, 0.8], 3);
  assert.doesNotMatch(sql, /WHERE/);
  assert.match(sql, /ORDER BY embedding <=> \$1\s+LIMIT 3$/);
  assert.deepEqual(valeurs, ["[0.6,0.8]"]);
});

test("requete numérote chaque filtre après le vecteur de la question", () => {
  const { sql, valeurs } = requete([0.6, 0.8], 5, { sites: ["nantes"], types: ["faq", "politique"], langue: "fr" });
  assert.match(sql, /WHERE sites && \$2 AND type = ANY\(\$3\) AND langue = \$4/);
  assert.deepEqual(valeurs, ["[0.6,0.8]", ["nantes"], ["faq", "politique"], "fr"]);
});

test("requete garde la version en vigueur à la date demandée, avec une seule valeur pour les deux comparaisons", () => {
  const { sql, valeurs } = requete([0.6, 0.8], 5, { enVigueurLe: "2026-01-15" });
  assert.match(sql, /WHERE date_effet <= \$2 AND \(date_fin IS NULL OR date_fin > \$2\)/);
  assert.deepEqual(valeurs, ["[0.6,0.8]", "2026-01-15"]);
});

test("requete ne garde que les documents dont l'accès est permis", () => {
  const { sql, valeurs } = requete([0.6, 0.8], 5, { enVigueurLe: "2026-10-05", acces: ["tous"] });
  assert.match(sql, /WHERE date_effet <= \$2 AND \(date_fin IS NULL OR date_fin > \$2\) AND acces = ANY\(\$3\)/);
  assert.deepEqual(valeurs, ["[0.6,0.8]", "2026-10-05", ["tous"]]);
});
