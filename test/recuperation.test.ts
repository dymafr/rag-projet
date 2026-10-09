// Tests des métriques de récupération, sur un exemple calculé à la main. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mesurerRecuperation, moyennes, ndcg, precision, rangReciproque, rappel, succes } from "../src/eval/recuperation.ts";

// Trois passages attendus : A et C répondent (note 2), B aide (note 1). La recherche classe X, A, B, Y, C
const notes = { A: 2, B: 1, C: 2 };
const trouves = ["X", "A", "B", "Y", "C"];
const proche = (obtenu: number, attendu: number) => assert.ok(Math.abs(obtenu - attendu) < 1e-3, `${obtenu} au lieu de ${attendu}`);

test("succès@k : un passage qui répond (noté 2) est-il dans les k premiers ?", () => {
  assert.equal(succes(trouves, notes, 1), 0); // X n'est pas attendu
  assert.equal(succes(trouves, notes, 2), 1); // A, noté 2, est deuxième
  assert.equal(succes(["X", "B"], notes, 5), 0); // B aide (noté 1) mais ne répond pas seul
});

test("rappel@k : la part des passages attendus trouvés dans les k premiers", () => {
  assert.equal(rappel(trouves, notes, 5), 1);
  proche(rappel(trouves, notes, 3), 2 / 3);
  proche(rappel(trouves, notes, 2), 1 / 3);
  assert.equal(rappel(trouves, notes, 1), 0);
});

test("précision@k : la part des k premiers qui sont attendus, places vides comprises", () => {
  assert.equal(precision(trouves, notes, 5), 0.6);
  assert.equal(precision(trouves, notes, 2), 0.5);
  assert.equal(precision(trouves, notes, 8), 0.375); // 3 sur 8 : la recherche n'a rendu que 5 résultats
});

test("rang réciproque : 1 sur le rang du premier passage attendu, 0 s'il n'est pas dans les k premiers", () => {
  assert.equal(rangReciproque(trouves, notes, 5), 0.5);
  assert.equal(rangReciproque(["A", "X"], notes, 5), 1);
  assert.equal(rangReciproque(trouves, notes, 1), 0);
});

test("nDCG@k : les notes, atténuées par le rang, rapportées au classement idéal", () => {
  // DCG = 2/log2(3) + 1/log2(4) + 2/log2(6) = 2,536 ; idéal (2, 2, 1) = 2/log2(2) + 2/log2(3) + 1/log2(4) = 3,762
  proche(ndcg(trouves, notes, 5), 0.674);
  assert.equal(ndcg(["A", "C", "B"], notes, 5), 1);
  assert.equal(ndcg(["X", "Y"], notes, 5), 0);
  // Classer B (note 1) avant A et C (note 2) coûte des points, même si les trois sont trouvés
  assert.ok(ndcg(["B", "A", "C"], notes, 5) < 1);
});

test("un identifiant qui ressemble à une propriété d'objet n'est pas compté comme pertinent", () => {
  assert.equal(precision(["toString", "constructor"], notes, 2), 0);
  assert.equal(ndcg(["toString"], notes, 1), 0);
});

test("les moyennes sur plusieurs questions donnent notamment le MRR", () => {
  const m = moyennes([
    mesurerRecuperation(["A"], notes, 1), // RR 1
    mesurerRecuperation(["X", "C"], notes, 2), // RR 0,5
    mesurerRecuperation(["X"], notes, 1), // RR 0
  ]);
  assert.equal(m.rangReciproque, 0.5);
  proche(m.rappel, (1 / 3 + 1 / 3 + 0) / 3);
});
