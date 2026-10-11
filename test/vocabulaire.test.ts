// Tests du vocabulaire : les sigles et synonymes ajoutés à la requête du plein texte. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { enrichir } from "../src/recherche/vocabulaire.ts";

test("vocabulaire : un sigle de la question ajoute sa forme longue, et inversement", () => {
  assert.equal(enrichir("tt c'est combien par semaine ?"), "tt c'est combien par semaine ? (télétravail)");
  assert.equal(enrichir("Combien de jours de réduction du temps de travail ?"), "Combien de jours de réduction du temps de travail ? (rtt)");
  assert.equal(enrichir("je pose des CP ou des RTT ?"), "je pose des CP ou des RTT ? (congés payés, réduction du temps de travail)");
});

test("vocabulaire : mots entiers seulement, sans tenir compte des accents ni des majuscules", () => {
  assert.equal(enrichir("Puis-je utiliser mon CPF ?"), "Puis-je utiliser mon CPF ? (compte personnel de formation)"); // cpf, pas cp
  assert.equal(enrichir("le teletravail depuis Lisbonne"), "le teletravail depuis Lisbonne (tt)");
  assert.equal(enrichir("Quel est le plafond pour un hôtel à Paris ?"), "Quel est le plafond pour un hôtel à Paris ?"); // rien à ajouter
  assert.equal(enrichir("dej client perdu", [["repas", "déjeuner", "dej"]]), "dej client perdu (repas, déjeuner)");
});
