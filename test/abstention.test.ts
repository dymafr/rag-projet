// Tests de l'abstention : le seuil avant le LLM, et la règle « pas de source, pas de réponse » après. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { appuyee, horsCorpus, SEUIL } from "../src/generation/abstention.ts";
import type { Resultat } from "../src/recherche/vectorielle.ts";

const resultat = (score: number): Resultat => ({ id: "FAQ-RH#2", document: "FAQ-RH", titres: [], texte: "…", score });

test("horsCorpus regarde le meilleur passage, et juge hors corpus une recherche sans résultat", () => {
  assert.equal(horsCorpus([resultat(0.888), resultat(0.7)], 0.81), false); // seuil en argument : le test ne dépend pas de SEUIL
  assert.equal(horsCorpus([resultat(0.799)], 0.81), true);
  assert.equal(horsCorpus([]), true);
  assert.equal(horsCorpus([resultat(0.799)], 0.75), false);
  assert.ok(SEUIL > 0 && SEUIL < 1);
});

test("appuyee demande une citation retrouvée quand il y a des extraits, un numéro cité sinon", () => {
  assert.equal(appuyee([1], [{ numero: 1, texteCite: "Trois jours.", trouvee: true }]), true);
  assert.equal(appuyee([1], [{ numero: 1, texteCite: "Quatre jours.", trouvee: false }]), false);
  assert.equal(appuyee([2], []), true);
  assert.equal(appuyee([], []), false);
});
