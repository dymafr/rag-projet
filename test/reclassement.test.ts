// Tests du reclassement, avec des passages écrits à la main et un faux LLM. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Llm } from "../src/llm.ts";
import { parLeLlm, reclasser, type Reclasseur } from "../src/recherche/rerank.ts";
import type { Resultat } from "../src/recherche/vectorielle.ts";

const passage = (id: string, score = 0.5): Resultat => ({ id, document: id.split("#")[0], titres: [id], texte: `texte de ${id}`, score });
const ids = (resultats: Resultat[]) => resultats.map((r) => r.id);

test("reclasser : trier par note et garder les k meilleurs, sans toucher au score (la similarité cosinus)", async () => {
  const notes: Reclasseur = async (_q, passages) => passages.map((p) => ({ "A#1": 0.1, "B#1": 0.9, "C#1": 0.5 })[p.id]!);
  const resultats = await reclasser("question", [passage("A#1", 0.8), passage("B#1", 0.6), passage("C#1", 0.7)], notes, 2);
  assert.deepEqual(ids(resultats), ["B#1", "C#1"]);
  assert.equal(resultats[0].score, 0.6);
  assert.deepEqual(await reclasser("question", [], notes, 2), []);
});

test("le LLM classe par liste : les numéros qu'il cite d'abord ; un oublié reste après, dans l'ordre reçu", async () => {
  const llm: Llm = async () => ({ texte: '{"ordre": [3, 9, 1, 3]}', usage: { entree: 0, enCache: 0, sortie: 0 } }); // 9 inconnu, 3 répété
  const resultats = await reclasser("question", [passage("A#1"), passage("B#1"), passage("C#1")], parLeLlm(llm), 3);
  assert.deepEqual(ids(resultats), ["C#1", "A#1", "B#1"]);
  // Des numéros inconnus avant le seul passage cité ne le font pas reculer derrière les oubliés
  const boucle: Llm = async () => ({ texte: '{"ordre": [9, 9, 9, 9, 2]}', usage: { entree: 0, enCache: 0, sortie: 0 } });
  assert.deepEqual(ids(await reclasser("question", [passage("A#1"), passage("B#1"), passage("C#1")], parLeLlm(boucle), 3)), ["B#1", "A#1", "C#1"]);
});

test("le LLM ne lit que les premiers candidats : les suivants restent derrière, dans l'ordre reçu", async () => {
  const prompts: string[] = [];
  const llm: Llm = async (_consigne, donnees) => {
    prompts.push(donnees);
    return { texte: '{"ordre": [2, 1]}', usage: { entree: 0, enCache: 0, sortie: 0 } };
  };
  const resultats = await reclasser("question", [passage("A#1"), passage("B#1"), passage("C#1")], parLeLlm(llm, 2), 3);
  assert.deepEqual(ids(resultats), ["B#1", "A#1", "C#1"]);
  assert.ok(!prompts[0].includes("C#1")); // le troisième n'est pas dans le prompt
});

test("chapitre 14, leçon 8 : si le LLM refuse ou tombe, l'ordre de la recherche est gardé, sans faire échouer la recherche", async () => {
  const refus: Llm = async () => {
    throw new Error("400 Invalid prompt: your prompt was flagged");
  };
  const resultats = await reclasser("question", [passage("A#1"), passage("B#1"), passage("C#1")], parLeLlm(refus), 2);
  assert.deepEqual(ids(resultats), ["A#1", "B#1"]);
});
