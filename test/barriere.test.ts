// Tests de la barrière de qualité à deux juges (chapitre 14, leçon 5) : la règle, l'accord des juges et la décision, avant
// et après la relecture indépendante des désaccords. Sans LLM ni base. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { accordDe, deciderBarriere, lireJuge, Regle } from "../src/eval/barriere.ts";
import type { ResultatQuestion } from "../src/eval/production.ts";

const regle = Regle.parse({ echecsPermis: 3, nonJugeesPermises: 0, juges: ["anthropic:claude-haiku-5-5", "openai:gpt-6-luna"], attaques: true });
const jugee = (a: boolean | null, b: boolean | null) => ({ verdict: { reussie: a, criteres: [] }, verdictSecond: { reussie: b, criteres: [] } }) as unknown as ResultatQuestion;

test("la règle demande deux juges écrits fournisseur:modèle ; un modèle peut contenir « : »", () => {
  assert.equal(Regle.safeParse({ ...regle, juges: ["anthropic:claude-haiku-5-5"] }).success, false);
  assert.equal(Regle.safeParse({ ...regle, juges: ["claude-haiku-5-5", "openai:gpt-6-luna"] }).success, false);
  assert.equal(Regle.safeParse({ ...regle, juges: ["openai:gpt-6-luna", "openai:gpt-6.1-sol"] }).success, false); // même fournisseur
  assert.deepEqual(lireJuge("ollama:gemma4:e4b"), { fournisseur: "ollama", modele: "gemma4:e4b" });
});

test("l'accord des deux juges : réussies et échouées pour les deux, désaccords, non jugées si l'un n'a pas jugé", () => {
  const resultats = [jugee(true, true), jugee(true, true), jugee(false, false), jugee(true, false), jugee(false, true), jugee(true, null)];
  assert.deepEqual(accordDe(resultats), { reussies: 2, echouees: 1, desaccords: 2, nonJugees: 1 });
  // Sans second juge, rien n'est jugé deux fois
  assert.equal(accordDe([{ verdict: { reussie: true, criteres: [] } } as unknown as ResultatQuestion]).nonJugees, 1);
});

test("un désaccord non tranché compte comme un échec ; la relecture ne peut que le trancher", () => {
  // 2 échecs sûrs et 1 désaccord : 3 échecs, la barrière passe
  assert.equal(deciderBarriere(regle, { reussies: 157, echouees: 2, desaccords: 1, nonJugees: 0 }).franchie, true);
  // 2 échecs sûrs et 3 désaccords : 5 échecs, mais la relecture peut la faire passer si elle en accepte 2
  const avant = deciderBarriere(regle, { reussies: 155, echouees: 2, desaccords: 3, nonJugees: 0 });
  assert.deepEqual(avant, { franchie: false, echecs: 5, aTrancher: 3, relireUtile: true, aAccepter: 2 });
  assert.equal(deciderBarriere(regle, { reussies: 155, echouees: 2, desaccords: 3, nonJugees: 0 }, { reussies: 2, echouees: 1 }).franchie, true);
  assert.equal(deciderBarriere(regle, { reussies: 155, echouees: 2, desaccords: 3, nonJugees: 0 }, { reussies: 1, echouees: 2 }).franchie, false);
  // 4 échecs sûrs : aucune relecture n'y changera rien
  assert.equal(deciderBarriere(regle, { reussies: 155, echouees: 4, desaccords: 1, nonJugees: 0 }).relireUtile, false);
  assert.throws(() => deciderBarriere(regle, { reussies: 159, echouees: 0, desaccords: 1, nonJugees: 0 }, { reussies: 2, echouees: 0 }));
});

test("une question non jugée compte comme un échec et la règle n'en permet aucune", () => {
  const d = deciderBarriere(regle, { reussies: 159, echouees: 0, desaccords: 0, nonJugees: 1 });
  assert.equal(d.franchie, false);
  assert.equal(d.relireUtile, false);
});
