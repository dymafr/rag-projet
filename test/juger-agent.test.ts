// Tests du bilan de l'agent jugé (chapitre 10) : une question réussie, la comparaison avec une autre évaluation, et le
// critère de refus du juge, avec un faux LLM. Ni base, ni réseau. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { bilanAgent, reussie } from "../src/eval/agent.ts";
import { CRITERES, juger } from "../src/eval/juge.ts";
import type { Llm } from "../src/llm.ts";

test("une question couverte est réussie si la réponse est exacte ; une autre, si l'agent a refusé", () => {
  assert.equal(reussie({ id: "Q01", categorie: "couverte", exactitude: true, fidelite: false }), true);
  assert.equal(reussie({ id: "Q02", categorie: "couverte", exactitude: null }), false);
  assert.equal(reussie({ id: "Q31", categorie: "hors-corpus", refus: true }), true);
  assert.equal(reussie({ id: "Q37", categorie: "interdite", refus: false }), false);
});

test("bilanAgent compte les réussites et compare question par question avec une autre évaluation", () => {
  const verdicts = [
    { id: "Q01", categorie: "couverte", exactitude: true, fidelite: true },
    { id: "Q02", categorie: "couverte", exactitude: false, fidelite: true },
    { id: "Q31", categorie: "hors-corpus", refus: true },
  ];
  const reference = new Map([["Q01", false], ["Q02", true], ["Q31", true]]);
  const b = bilanAgent(verdicts, reference);
  assert.deepEqual([b.reussies, b.total, b.exactes, b.fideles, b.refusJustes], [2, 3, 1, 2, 1]);
  assert.deepEqual([b.comparaison?.gagnees, b.comparaison?.perdues], [["Q01"], ["Q02"]]);
});

test("le critère de refus donne au juge la question et la réponse, et lit son verdict", async () => {
  const recus: string[] = [];
  const llm: Llm = async (debut, fin) => (recus.push(debut + fin), { texte: '{"raison": "Elle dit ne pas savoir.", "verdict": "oui"}', usage: { entree: 1, enCache: 0, sortie: 1 } });
  const j = await juger(llm, "refus", { question: "Quel temps fera-t-il ?", reponse: "Je ne traite que les questions RH.", passages: [] });
  assert.equal(j.verdict, true);
  assert.match(recus[0], /<question>\nQuel temps fera-t-il \?\n<\/question>/);
  assert.match(CRITERES.refus.consigne, /aucune information sur le fond/);
});
