// Tests de l'indexation incrémentale : le plan, calculé à partir des empreintes, sans base. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { planifier } from "../src/stockage/incremental.ts";

const enBase = [
  { id: "FAQ-RH#2", empreinte: "t1", empreinte_meta: "m1" },
  { id: "FAQ-RH#19", empreinte: "t2", empreinte_meta: "m1" },
  { id: "POL-TT-01#8", empreinte: "t3", empreinte_meta: "m2" },
  { id: "INT-ANCIEN#1", empreinte: "t4", empreinte_meta: "m3" },
];

test("planifier ne garde que la différence entre les chunks voulus et la base", () => {
  const voulus = [
    { id: "FAQ-RH#2", empreinte: "t1", empreinte_meta: "m1" }, // inchangé
    { id: "FAQ-RH#19", empreinte: "t2-modifie", empreinte_meta: "m1" }, // texte modifié
    { id: "POL-TT-01#8", empreinte: "t3", empreinte_meta: "m2-date-de-fin" }, // métadonnées seules
    { id: "FAQ-RH#61", empreinte: "t5", empreinte_meta: "m1" }, // nouveau
  ];
  const plan = planifier(voulus, enBase);
  assert.deepEqual(plan.aVectoriser.map((v) => v.id), ["FAQ-RH#19", "FAQ-RH#61"]);
  assert.deepEqual(plan.aMettreAJour.map((v) => v.id), ["POL-TT-01#8"]);
  assert.deepEqual(plan.aSupprimer, ["INT-ANCIEN#1"]);
  assert.equal(plan.inchanges, 1);
});

test("planifier sur une base vide : tout est à vectoriser", () => {
  const plan = planifier(enBase, []);
  assert.equal(plan.aVectoriser.length, 4);
  assert.deepEqual([plan.aMettreAJour.length, plan.aSupprimer.length, plan.inchanges], [0, 0, 0]);
});

test("un texte et des métadonnées modifiés ensemble : vectorisé une fois, pas mis à jour en plus", () => {
  const plan = planifier([{ id: "FAQ-RH#2", empreinte: "autre", empreinte_meta: "autre" }], enBase.slice(0, 1));
  assert.deepEqual([plan.aVectoriser.length, plan.aMettreAJour.length], [1, 0]);
});
