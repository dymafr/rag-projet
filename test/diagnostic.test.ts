// Tests du diagnostic de la récupération, sur des exemples écrits à la main. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { comparerDiagnostics, diagnostiquer, diagnostiquerTraces } from "../src/eval/diagnostic.ts";
import type { QuestionDeReference } from "../src/eval/jeu.ts";
import type { FichierDeTraces } from "../src/eval/traces.ts";

// A répond (noté 2), B aide sans répondre seul (noté 1) ; X, Y, Z ne sont pas attendus
const notes = { A: 2, B: 1 };

test("trouvé : le passage qui répond est dans les k premiers, avec peu de passages non pertinents devant lui", () => {
  assert.deepEqual(diagnostiquer(["A", "X"], notes, 8), { diagnostic: "trouve", rang: 1, devant: 0 });
  // B aide : il n'est pas compté comme du bruit
  assert.deepEqual(diagnostiquer(["X", "B", "Y", "A"], notes, 8), { diagnostic: "trouve", rang: 4, devant: 2 });
});

test("noyé : dans les k premiers, mais derrière au moins trois passages non pertinents", () => {
  assert.deepEqual(diagnostiquer(["X", "Y", "Z", "A"], notes, 8), { diagnostic: "noye", rang: 4, devant: 3 });
});

test("mal classé : parmi les candidats, mais après le rang k ; absent : dans aucun des candidats", () => {
  assert.deepEqual(diagnostiquer(["X", "Y", "A"], notes, 2), { diagnostic: "mal-classe", rang: 3, devant: 2 });
  assert.deepEqual(diagnostiquer(["B", "X"], notes, 8), { diagnostic: "absent", rang: null, devant: 0 }); // B ne répond pas seul
  assert.equal(diagnostiquer([], notes, 8).diagnostic, "absent");
  assert.equal(diagnostiquer(["toString"], notes, 8).diagnostic, "absent"); // un nom de propriété d'objet n'est pas un passage noté
});

const question = (id: string, passages: Record<string, 1 | 2>): QuestionDeReference =>
  ({ id, question: `question ${id}`, categorie: "couverte", origine: "ecrite", reponse: "réponse", passages });
const fichier = (candidats: Record<string, string[]>): FichierDeTraces => ({
  date: "2026-10-10",
  embeddings: "test",
  recherche: "test",
  profondeur: 50,
  traces: Object.entries(candidats).map(([id, liste]) => ({ id, question: `question ${id}`, candidats: liste.map((c) => ({ id: c, score: 0 })) })),
});

test("le diagnostic des traces ne garde que les questions couvertes", () => {
  const jeu: QuestionDeReference[] = [question("Q01", { A: 2 }), { id: "Q31", question: "météo", categorie: "hors-corpus", origine: "ecrite" }];
  const lignes = diagnostiquerTraces(fichier({ Q01: ["A"], Q31: ["X"] }), jeu, 8);
  assert.deepEqual(lignes.map((l) => l.id), ["Q01"]);
  assert.equal(lignes[0].mesures.succes, 1);
});

test("comparer deux recherches : questions gagnées et perdues, diagnostics qui changent", () => {
  const jeu = [question("Q01", { A: 2 }), question("Q02", { C: 2 }), question("Q03", { D: 2 })];
  const avant = diagnostiquerTraces(fichier({ Q01: ["A"], Q02: ["X", "C"], Q03: ["D"] }), jeu, 1);
  const apres = diagnostiquerTraces(fichier({ Q01: ["X", "A"], Q02: ["C"], Q03: ["D"] }), jeu, 1);
  const c = comparerDiagnostics(avant, apres);
  assert.deepEqual(c.gagnees, ["Q02"]);
  assert.deepEqual(c.perdues, ["Q01"]);
  assert.deepEqual(c.changees.map((p) => p.apres.id), ["Q01", "Q02"]);
  assert.equal(c.p, 1); // un gain et une perte : rien ne permet de conclure
});
