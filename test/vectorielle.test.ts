// Tests de la requête de recherche vectorielle, sans base : le SQL produit et ses valeurs. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { requete, type Filtres } from "../src/recherche/vectorielle.ts";

test("requete trie sur la distance à la question ; le seul filtre toujours présent est le niveau d'accès", () => {
  const { sql, valeurs } = requete([0.6, 0.8], 3, { acces: ["tous"] });
  assert.match(sql, /WHERE acces = ANY\(\$2\)\s+ORDER BY embedding <=> \$1\s+LIMIT 3$/);
  assert.deepEqual(valeurs, ["[0.6,0.8]", ["tous"]]);
});

test("requete refuse de chercher sans niveau d'accès, plutôt que de chercher partout (chapitre 13)", () => {
  // Le compilateur refuse déjà un filtre sans acces ; il ne voit ni une liste vide, ni un objet venu d'un JSON
  assert.throws(() => requete([0.6, 0.8], 3, { acces: [] }), /Recherche refusée : aucun niveau d'accès/);
  assert.throws(() => requete([0.6, 0.8], 3, JSON.parse('{"acces":"{tous,manager,rh}"}')), /Recherche refusée/); // une chaîne, pas une liste
  assert.throws(() => requete([0.6, 0.8], 3, JSON.parse('{"types": ["faq"]}') as Filtres), /aucun niveau d'accès/);
});

test("requete numérote chaque filtre après le vecteur de la question", () => {
  const { sql, valeurs } = requete([0.6, 0.8], 5, { sites: ["nantes"], types: ["faq", "politique"], langue: "fr", acces: ["tous"] });
  assert.match(sql, /WHERE sites && \$2 AND type = ANY\(\$3\) AND langue = \$4 AND acces = ANY\(\$5\)/);
  assert.deepEqual(valeurs, ["[0.6,0.8]", ["nantes"], ["faq", "politique"], "fr", ["tous"]]);
});

test("requete garde la version en vigueur à la date demandée, avec une seule valeur pour les deux comparaisons", () => {
  const { sql, valeurs } = requete([0.6, 0.8], 5, { enVigueurLe: "2026-01-15", acces: ["tous"] });
  // Chapitre 14 : un ticket n'est pas une version en vigueur, c'est une trace ; la date de vigueur ne l'écarte pas
  assert.match(sql, /WHERE \(type = 'ticket' OR \(date_effet <= \$2 AND \(date_fin IS NULL OR date_fin > \$2\)\)\)/);
  assert.deepEqual(valeurs, ["[0.6,0.8]", "2026-01-15", ["tous"]]);
});

test("requete ne garde que les documents dont l'accès est permis, et rien d'écrit après le jour de la question", () => {
  const { sql, valeurs } = requete([0.6, 0.8], 5, { enVigueurLe: "2026-06-30", existeLe: "2026-10-05", acces: ["tous"] });
  assert.match(sql, /WHERE \(type = 'ticket' OR \(date_effet <= \$2 AND \(date_fin IS NULL OR date_fin > \$2\)\)\) AND date_effet <= \$3 AND acces = ANY\(\$4\)/);
  assert.deepEqual(valeurs, ["[0.6,0.8]", "2026-06-30", "2026-10-05", ["tous"]]);
});
