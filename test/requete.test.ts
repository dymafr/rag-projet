// Tests de ce que le LLM fait de la question avant la recherche : transformations, filtres extraits.
// Le LLM est un faux, qui rend des réponses écrites à l'avance et note ce qu'on lui a demandé. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Llm } from "../src/llm.ts";
import { aDesIndices, extraireFiltres } from "../src/recherche/filtres-extraits.ts";
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

test("filtres extraits : une date ou un type quand la question les précise, sinon aucun appel au LLM", async () => {
  const sansIndice = fauxLlm();
  assert.deepEqual(await extraireFiltres("Combien de jours de congé pour mon mariage ?", "2026-10-10", sansIndice.llm), {});
  assert.equal(sansIndice.recus.length, 0);
  const { llm } = fauxLlm('{"date": "2026-01-15", "types": null}');
  assert.deepEqual(await extraireFiltres("Combien de jours de télétravail en janvier 2026 ?", "2026-10-10", llm), { enVigueurLe: "2026-01-15" });
  const type = fauxLlm('{"date": null, "types": ["faq"]}');
  assert.deepEqual(await extraireFiltres("Que dit la FAQ sur la mutuelle ?", "2026-10-10", type.llm), { types: ["faq"] });
});

test("filtres extraits : une réponse hors du schéma n'ajoute aucun filtre", async () => {
  // Un type inconnu (les tickets sont fermés à Rhéa), puis une date mal écrite : deux réponses invalides
  const { llm } = fauxLlm('{"date": null, "types": ["ticket"]}', '{"date": "janvier 2026", "types": null}');
  assert.deepEqual(await extraireFiltres("Selon la FAQ, en janvier 2026 ?", "2026-10-10", llm), {});
  // Une liste de types vide veut dire « aucun type » : la date reste
  const vide = fauxLlm('{"date": "2025-06-30", "types": []}');
  assert.deepEqual(await extraireFiltres("En 2025, combien pour un siège ?", "2026-10-10", vide.llm), { enVigueurLe: "2025-06-30" });
});

test("filtres extraits : seuls des mots entiers déclenchent le LLM (« mai » n'est pas dans « semaine »)", () => {
  assert.equal(aDesIndices("Combien de jours de télétravail ai-je par semaine ?"), false);
  assert.equal(aDesIndices("Mon ancienneté compte-t-elle pour les avantages ?"), false);
  assert.equal(aDesIndices("Je rentre demain, je pose quoi ?"), false);
  assert.equal(aDesIndices("Qu'avait-on en mai 2025 ?"), true);
  assert.equal(aDesIndices("Combien l'an dernier ?"), true);
  assert.equal(aDesIndices("Que dit la FAQ ?"), true);
});
