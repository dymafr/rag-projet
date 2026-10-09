// Tests de la réponse de Claude avec citations natives, sans clé ni réseau. La réponse simulée suit la forme
// documentée par Anthropic : des blocs de texte, certains avec une citation search_result_location. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { blocDeRecherche, lireReponse, repondreAvecClaude } from "../src/generation/claude.ts";
import type { PromptAugmente } from "../src/generation/prompt.ts";
import type { Resultat } from "../src/recherche/vectorielle.ts";

const faq: Resultat = {
  id: "FAQ-RH#2",
  document: "FAQ-RH",
  titres: ["FAQ RH de Kalyo", "Combien de jours de télétravail ai-je par semaine ?"],
  texte: "## Combien de jours de télétravail ai-je par semaine ?\n\nDepuis le 1er mars 2026, vous pouvez télétravailler jusqu'à trois jours par semaine.",
  score: 0.888,
};
const prompt: PromptAugmente = { systeme: "Tu es Rhéa.", utilisateur: "", passages: [faq], ecartes: [], question: "Combien de jours ?", date: "2026-10-05" };

// La réponse : un bloc de réflexion (vide, comme sur les modèles qui réfléchissent d'office), puis deux blocs de texte
const contenu = [
  { type: "thinking", thinking: "", signature: "…" },
  {
    type: "text",
    text: "Vous pouvez télétravailler trois jours par semaine depuis le 1er mars 2026.",
    citations: [
      {
        type: "search_result_location",
        cited_text: "Depuis le 1er mars 2026, vous pouvez télétravailler jusqu'à trois jours par semaine.",
        source: "FAQ-RH#2",
        title: "FAQ RH de Kalyo > Combien de jours de télétravail ai-je par semaine ?",
        search_result_index: 0,
        start_block_index: 1,
        end_block_index: 2,
      },
    ],
  },
  { type: "text", text: " Parlez-en à votre manager.", citations: null },
] as unknown as Anthropic.ContentBlock[];

test("blocDeRecherche fait un bloc de texte par paragraphe, avec la source, le titre et les citations activées", () => {
  const bloc = blocDeRecherche(faq);
  assert.equal(bloc.source, "FAQ-RH#2");
  assert.equal(bloc.title, "FAQ RH de Kalyo > Combien de jours de télétravail ai-je par semaine ?");
  assert.equal(bloc.content.length, 2);
  assert.deepEqual(bloc.citations, { enabled: true });
});

test("lireReponse recolle le texte, ajoute [n] après chaque bloc cité et garde le texte cité", () => {
  const { texte, citations } = lireReponse(contenu);
  assert.equal(texte, "Vous pouvez télétravailler trois jours par semaine depuis le 1er mars 2026.[1] Parlez-en à votre manager.");
  assert.deepEqual(citations, [{ numero: 1, texteCite: "Depuis le 1er mars 2026, vous pouvez télétravailler jusqu'à trois jours par semaine." }]);
});

// Un faux client : il garde la requête reçue et renvoie la réponse qu'on lui donne
function fauxClient(reponse: object) {
  const requetes: Record<string, any>[] = [];
  const client = { messages: { create: async (requete: Record<string, any>) => (requetes.push(requete), reponse) } };
  return { client: client as unknown as Anthropic, requetes };
}

test("repondreAvecClaude envoie le prompt système, les blocs des passages puis la question", async () => {
  const { client, requetes } = fauxClient({ content: contenu, stop_reason: "end_turn", usage: { input_tokens: 700, output_tokens: 40 } });
  const { texte, usage } = await repondreAvecClaude(client, "modele-test", prompt);
  assert.match(texte, /\[1\]/);
  assert.deepEqual(usage, { entree: 700, enCache: 0, sortie: 40 });
  assert.equal(requetes[0].system, "Tu es Rhéa.");
  const blocs = requetes[0].messages[0].content;
  assert.deepEqual(blocs.map((b: { type: string }) => b.type), ["search_result", "text"]);
  assert.ok(blocs[1].text.endsWith("Question : Combien de jours ?"));
});

test("repondreAvecClaude refuse une réponse interrompue, refus compris", async () => {
  const refus = { content: [], stop_reason: "refusal", stop_details: { type: "refusal", category: null, explanation: "Demande refusée." }, usage: { input_tokens: 700, output_tokens: 0 } };
  await assert.rejects(repondreAvecClaude(fauxClient(refus).client, "modele-test", prompt), /refusal \(Demande refusée\.\)/);
});
