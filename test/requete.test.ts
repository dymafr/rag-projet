// Tests de ce que le LLM fait de la question avant la recherche : les transformations.
// Le LLM est un faux, qui rend des réponses écrites à l'avance et note ce qu'on lui a demandé. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Llm } from "../src/llm.ts";
import { transformer } from "../src/recherche/transformations.ts";

// Un faux LLM : il rend ses réponses dans l'ordre, et garde la fin de chaque prompt reçu
function fauxLlm(...reponses: string[]) {
  const recus: string[] = [];
  const llm: Llm = async (_debut, fin) => {
    recus.push(fin);
    return { texte: reponses.shift() ?? "", usage: { entree: 0, enCache: 0, sortie: 0 } };
  };
  return { llm, recus };
}

test("transformer : les requêtes du LLM (un seul passage pour HyDE), ou la question telle quelle s'il ne rend rien de lisible", async () => {
  const { llm } = fauxLlm('{"requetes": ["jours de télétravail par semaine", "nombre de jours en télétravail"]}');
  assert.deepEqual(await transformer("tt combien ?", "multiplier", llm), ["jours de télétravail par semaine", "nombre de jours en télétravail"]);
  const hyde = fauxLlm('{"requetes": ["Les RTT se posent dans l\'espace RH.", "Le manager les valide."]}');
  assert.deepEqual(await transformer("rtt ?", "hyde", hyde.llm), ["Les RTT se posent dans l'espace RH. Le manager les valide."]);
  const illisible = fauxLlm("je ne sais pas", "toujours pas");
  assert.deepEqual(await transformer("tt combien ?", "reecrire", illisible.llm), ["tt combien ?"]);
  assert.equal(illisible.recus.length, 2); // un second essai, puis on abandonne
});
