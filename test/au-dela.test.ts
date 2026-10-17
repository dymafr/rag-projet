// Tests du jeu « au-delà du texte » (chapitre 12, leçon 1) : le fichier est valide, et la vérification mécanique des
// réponses ne se trompe ni sur les accents, ni sur les nombres. Pas de LLM. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { contient, lireJeuAuDela, verdict } from "../src/eval/au-dela.ts";

test("eval/jeu-c12.json est valide, avec des identifiants uniques et chaque famille représentée", async () => {
  const jeu = await lireJeuAuDela();
  assert.equal(new Set(jeu.map((q) => q.id)).size, jeu.length);
  for (const famille of ["locale", "relationnelle", "statistique", "visuelle", "globale"]) {
    assert.ok(jeu.some((q) => q.famille === famille), famille);
  }
  // Une question globale n'a pas de mot attendu : elle n'est pas notée
  assert.ok(jeu.filter((q) => q.famille === "globale").every((q) => !q.attendu && !q.interdit));
});

test("contient ignore accents et majuscules, et lit la virgule décimale comme le point", () => {
  assert.ok(contient("Votre manager est EVA GUERIN.", "Eva Guérin"));
  assert.ok(contient("En moyenne 4.3 jours.", "4,3"));
  assert.ok(contient("En moyenne 4,3 jours.", "4,3"));
  assert.ok(!contient("En moyenne 4,35 jours.", "4,3"));
});

test("contient cherche un nombre entier, pas un morceau d'un autre nombre", () => {
  assert.ok(contient("Il vous reste 9 jours de RTT.", "9"));
  assert.ok(!contient("Votre équipe a 96 jours.", "9"));
  assert.ok(!contient("Depuis 2019.", "9"));
  assert.ok(!contient("Il en reste 9,5.", "9"));
  assert.ok(contient("Il y a 11 salariés.", "11"));
  assert.ok(!contient("Le site compte 110 salariés.", "11"));
});

test("verdict : tous les mots attendus, aucun mot interdit ; une question sans attente n'est pas notée", () => {
  const q = { id: "R1", famille: "relationnelle" as const, question: "?", attendu: ["Sylvain Rousseau"] };
  assert.equal(verdict(q, "Votre manager est Sylvain Rousseau."), "réussie");
  assert.equal(verdict(q, "Je ne sais pas."), "manquée");
  const variantes = { id: "L1", famille: "locale" as const, question: "?", attendu: ["trois|3"] };
  assert.equal(verdict(variantes, "Jusqu'à 3 jours par semaine."), "réussie");
  assert.equal(verdict(variantes, "Jusqu'à trois jours par semaine."), "réussie");
  const interdite = { id: "S7", famille: "statistique" as const, question: "?", interdit: ["11"] };
  assert.equal(verdict(interdite, "Vous ne voyez que vos propres données."), "réussie");
  assert.equal(verdict(interdite, "11 salariés sont concernés."), "manquée");
  assert.equal(verdict({ id: "G1", famille: "globale" as const, question: "?" }, "…"), "non notée");
});
