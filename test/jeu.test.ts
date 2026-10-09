// Tests du jeu d'évaluation : le schéma refuse les questions mal formées, et eval/jeu.json le respecte. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { Jeu, lireJeu, QuestionDeReference } from "../src/eval/jeu.ts";

const couverte = {
  id: "Q01",
  question: "Combien de jours de télétravail ai-je par semaine ?",
  categorie: "couverte",
  origine: "ecrite",
  reponse: "Jusqu'à trois jours par semaine, sur accord du manager.",
  passages: { "FAQ-RH#2": 2, "INT-ACTUALITES#7": 1 },
};

test("une question couverte a une réponse et au moins un passage qui répond", () => {
  assert.ok(QuestionDeReference.safeParse(couverte).success);
  assert.ok(QuestionDeReference.safeParse({ ...couverte, date: "2026-01-15" }).success);
  assert.equal(QuestionDeReference.safeParse({ ...couverte, passages: { "INT-ACTUALITES#7": 1 } }).success, false);
  assert.equal(QuestionDeReference.safeParse({ ...couverte, passages: { "FAQ-RH#2": 3 } }).success, false);
  const { reponse, ...sansReponse } = couverte;
  assert.equal(QuestionDeReference.safeParse(sansReponse).success, false);
});

test("une question hors corpus ou interdite n'a ni réponse ni passages", () => {
  const horsCorpus = { id: "Q31", question: "Quelle est la météo à Lyon demain ?", categorie: "hors-corpus", origine: "ecrite" };
  assert.ok(QuestionDeReference.safeParse(horsCorpus).success);
  assert.ok(QuestionDeReference.safeParse({ ...horsCorpus, categorie: "interdite" }).success);
  assert.equal(QuestionDeReference.safeParse({ ...horsCorpus, passages: { "FAQ-RH#2": 2 } }).success, false);
  assert.equal(QuestionDeReference.safeParse({ ...horsCorpus, categorie: "inconnue" }).success, false);
});

test("le jeu refuse un identifiant en double ou mal formé", () => {
  assert.equal(Jeu.safeParse([couverte, couverte]).success, false);
  assert.equal(Jeu.safeParse([{ ...couverte, id: "question-1" }]).success, false);
});

test("eval/jeu.json respecte le schéma et mêle les trois catégories", async () => {
  const jeu = await lireJeu();
  assert.ok(jeu.length >= 40); // le jeu grandira avec les échecs observés
  const categories = new Set(jeu.map((q) => q.categorie));
  assert.deepEqual([...categories].sort(), ["couverte", "hors-corpus", "interdite"]);
  assert.ok(jeu.some((q) => q.origine === "synthetique"));
});
