// Tests de l'analyse des erreurs : chaque problème rangé à la première étape où il apparaît. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bilan } from "../src/eval/bilan.ts";
import { classer, prioriser } from "../src/eval/erreurs.ts";
import type { QuestionDeReference } from "../src/eval/jeu.ts";
import type { ReponseEnregistree } from "../src/eval/reponses.ts";

const question: QuestionDeReference = {
  id: "Q05", question: "Quel plafond à Berlin ?", categorie: "couverte", origine: "ecrite", reponse: "Frais réels.",
  passages: { "GRP-TRV-01#10": 2, "POL-NF-01#2": 1 },
};
// Rhéa : les passages trouvés, ceux envoyés au LLM, et son abstention éventuelle
const rhea = (trouves: string[], envoyes: string[], abstention: ReponseEnregistree["abstention"] = null): ReponseEnregistree => ({
  id: "Q05", question: "", date: "2026-10-08", trouves: trouves.map((id) => ({ id, score: 0.9 })),
  passages: envoyes.map((id, i) => ({ numero: i + 1, id, texte: "" })), texte: "", sources: [], abstention, duree: 1,
});
// Le bilan de la question : réussie par défaut, avec des verdicts à changer selon le cas
const bilan = (changes: Partial<Bilan["questions"][number]> = {}): Bilan["questions"][number] => ({
  id: "Q05", categorie: "couverte", origine: "ecrite", abstention: null, recuperation: null, fidelite: true, pertinence: true, exactitude: true,
  citations: { rappel: 1, precision: 1, sourceAttendue: true, nonEtablies: 0 }, reussie: true, ...changes,
});

test("une erreur est rangée à la première étape où le passage qui répond se perd", () => {
  const ratee = bilan({ exactitude: false, reussie: false });
  // Le passage noté 2 n'est pas trouvé : peu importe la suite, il faut d'abord corriger la recherche
  assert.equal(classer(question, rhea(["FAQ-RH#19", "POL-NF-01#2"], ["FAQ-RH#19", "POL-NF-01#2"]), ratee), "recuperation");
  // Trouvé, mais pas envoyé au LLM
  assert.equal(classer(question, rhea(["FAQ-RH#19", "GRP-TRV-01#10"], ["FAQ-RH#19"]), ratee), "budget");
  // Envoyé, et Rhéa s'abstient quand même
  const abstenue = bilan({ abstention: "sans-source", exactitude: null, citations: null, reussie: false });
  assert.equal(classer(question, rhea(["GRP-TRV-01#10"], ["GRP-TRV-01#10"], "sans-source"), abstenue), "abstention");
  // Envoyé, et la réponse est fausse
  assert.equal(classer(question, rhea(["GRP-TRV-01#10"], ["GRP-TRV-01#10"]), ratee), "generation");
});

test("trouvé, mais Rhéa s'est arrêtée avant le LLM : c'est une abstention, pas un problème de budget", () => {
  const arretee = bilan({ abstention: "avant-llm", fidelite: null, pertinence: null, exactitude: null, citations: null, reussie: false });
  assert.equal(classer(question, rhea(["GRP-TRV-01#10"], [], "avant-llm"), arretee), "abstention");
});

test("une réponse juste peut encore avoir des citations à revoir, et une réponse sans problème n'est pas listée", () => {
  const envoye = rhea(["GRP-TRV-01#10"], ["GRP-TRV-01#10"]);
  assert.equal(classer(question, envoye, bilan({ citations: { rappel: 0.5, precision: 0.5, sourceAttendue: true, nonEtablies: 1 } })), "citations");
  // Une phrase sans citation (« Bonne journée. ») fait baisser le rappel, mais ce n'est pas une erreur à corriger
  assert.equal(classer(question, envoye, bilan({ citations: { rappel: 0.5, precision: 1, sourceAttendue: true, nonEtablies: 0 } })), null);
  assert.equal(classer(question, envoye, bilan()), null);
});

test("une réponse à une question hors corpus est une réponse à tort, une abstention n'est pas une erreur", () => {
  const hors: QuestionDeReference = { id: "Q31", question: "Quelle météo ?", categorie: "hors-corpus", origine: "ecrite" };
  const sansBilan = bilan({ categorie: "hors-corpus", citations: null });
  assert.equal(classer(hors, rhea([], []), sansBilan), "reponse-a-tort");
  assert.equal(classer(hors, rhea([], [], "avant-llm"), sansBilan), null);
});

test("les étapes qui font rater le plus de questions passent devant, puis les plus fréquentes", () => {
  const priorites = prioriser([
    { id: "Q18", etape: "citations", ratee: false },
    { id: "Q10", etape: "citations", ratee: false },
    { id: "Q26", etape: "citations", ratee: false },
    { id: "Q05", etape: "recuperation", ratee: true },
    { id: "Q27", etape: "recuperation", ratee: false },
    { id: "Q24", etape: "budget", ratee: true },
  ]);
  assert.deepEqual(priorites.map((p) => p.etape), ["recuperation", "budget", "citations"]);
  assert.deepEqual(priorites[0], { etape: "recuperation", questions: ["Q05", "Q27"], ratees: 1 });
});
