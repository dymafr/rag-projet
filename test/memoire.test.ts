// Tests de la recherche en mémoire et du cache de vecteurs. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { indexer, topK } from "../src/recherche/memoire.ts";
import { chargerFaq } from "../src/corpus/faq.ts";

// Un petit index en deux dimensions, avec des vecteurs de longueur 1
const index = [
  { id: "a", texte: "télétravail", vecteur: [1, 0] },
  { id: "b", texte: "congés", vecteur: [0, 1] },
  { id: "c", texte: "télétravail et congés", vecteur: [Math.SQRT1_2, Math.SQRT1_2] },
];

test("topK classe du plus proche au moins proche et garde k passages", () => {
  const resultats = topK([1, 0], index, 2);
  assert.deepEqual(resultats.map((r) => r.id), ["a", "c"]);
  assert.equal(resultats[0].score, 1);
});

test("topK écarte les passages sous le score minimal", () => {
  assert.deepEqual(topK([1, 0], index, 3, 0.5).map((r) => r.id), ["a", "c"]);
  assert.deepEqual(topK([-1, 0], index, 3, 0.5), []);
});

test("indexer ne recalcule que les textes nouveaux ou modifiés", async () => {
  const fichierCache = join(await mkdtemp(join(tmpdir(), "rhea-")), "cache.json");
  const envoyes: string[] = [];
  const fauxEmbedder = async (textes: string[]) => {
    envoyes.push(...textes);
    return textes.map((t) => [t.length, 1]);
  };
  await indexer([{ id: "1", texte: "un" }, { id: "2", texte: "deux" }], fauxEmbedder, fichierCache);
  assert.deepEqual(envoyes, ["un", "deux"]);

  envoyes.length = 0;
  const resultat = await indexer([{ id: "1", texte: "un" }, { id: "2", texte: "deux !" }], fauxEmbedder, fichierCache);
  assert.deepEqual(envoyes, ["deux !"]); // « un » vient du cache
  assert.deepEqual(resultat.map((p) => p.vecteur), [[2, 1], [6, 1]]);
});

test("la FAQ se lit en entrées question et réponse", async () => {
  const faq = await chargerFaq();
  assert.ok(faq.length >= 30);
  assert.equal(faq[0].id, "FAQ-RH#1");
  assert.match(faq[0].question, /télétravail/);
  assert.ok(faq.every((e) => e.question.endsWith("?") && e.reponse.length > 0));
});
