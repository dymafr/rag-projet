// Tests des options de recherche des outils d'évaluation : une valeur invalide arrête l'outil avant la première question.
// reglages.ts et options.ts ne lisent pas .env : le test n'a besoin de rien d'autre. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { decrire, lireReglages } from "../src/recherche/options.ts";
import { RECHERCHE } from "../src/recherche/reglages.ts";

test("options : sans option, les réglages de Rhéa ; une option les change le temps d'une exécution", () => {
  assert.deepEqual(lireReglages({}), RECHERCHE);
  const r = lireReglages({ mode: "vectorielle", poids: "1,0.25", candidats: "20" });
  assert.deepEqual([r.mode, r.poids, r.candidats], ["vectorielle", [1, 0.25], 20]);
  assert.equal(decrire(lireReglages({ vocabulaire: true, "filtres-extraits": false, condensation: false })), "hybride 1/0.5, vocabulaire");
});

test("options : une valeur invalide est refusée avec un message", () => {
  assert.throws(() => lireReglages({ mode: "semantique" }), /--mode attend vectorielle, plein-texte, hybride/);
  assert.throws(() => lireReglages({ poids: "1," }), /--poids/); // « » ne vaut pas 0
  assert.throws(() => lireReglages({ poids: "0,0" }), /--poids/); // tous les scores de la fusion vaudraient 0
  assert.throws(() => lireReglages({ candidats: "vingt" }), /--candidats/);
  assert.throws(() => lireReglages({ reclassement: true, reclasseur: "llm" }), /--candidats 20/); // 50 candidats : trop pour le LLM
  assert.throws(() => lireReglages({ diversite: "" }), /--diversite/);
  assert.throws(() => lireReglages({ reclassement: true, diversite: "0.7" }), /ne se combinent pas/);
});
