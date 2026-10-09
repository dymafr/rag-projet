// Tests de la réponse par l'API Responses, avec un faux client qui note la requête : ni clé, ni réseau. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import type OpenAI from "openai";
import { numerosCites } from "../src/generation/citations.ts";
import { repondreAvecResponses } from "../src/generation/openai.ts";
import type { PromptAugmente } from "../src/generation/prompt.ts";
import type { Resultat } from "../src/recherche/vectorielle.ts";

const passage = (id: string): Resultat => ({ id, document: id.split("#")[0], titres: ["Titre"], texte: "…", score: 0.8 });
const prompt: PromptAugmente = {
  systeme: "Tu es Rhéa.",
  utilisateur: "<passages>…</passages>\n\nDate du jour : 2026-10-05\n\nQuestion : Combien de jours ?",
  passages: [passage("FAQ-RH#2"), passage("POL-TT-02#10")],
  ecartes: [],
  question: "Combien de jours ?",
  date: "2026-10-05",
};

// Un faux client : il garde la requête reçue et renvoie la réponse qu'on lui donne
function fauxClient(reponse: object) {
  const requetes: Record<string, unknown>[] = [];
  const client = { responses: { create: async (requete: Record<string, unknown>) => (requetes.push(requete), { output: [], ...reponse }) } };
  return { client: client as unknown as OpenAI, requetes };
}

test("repondreAvecResponses envoie le prompt système en instructions et le message en input, sans rien stocker", async () => {
  const { client, requetes } = fauxClient({
    status: "completed",
    output_text: "Trois jours par semaine [1][2].",
    usage: { input_tokens: 900, input_tokens_details: { cached_tokens: 0 }, output_tokens: 12 },
  });
  const { texte, usage } = await repondreAvecResponses(client, "modele-test", prompt);
  assert.equal(texte, "Trois jours par semaine [1][2].");
  assert.deepEqual(usage, { entree: 900, enCache: 0, sortie: 12 });
  assert.equal(requetes[0].instructions, "Tu es Rhéa.");
  assert.equal(requetes[0].input, prompt.utilisateur);
  assert.equal(requetes[0].store, false);
  assert.equal(requetes[0].model, "modele-test");
});

test("repondreAvecResponses refuse une réponse coupée, même marquée complète comme le fait Ollama", async () => {
  const coupee = fauxClient({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output_text: "Trois jo" });
  await assert.rejects(repondreAvecResponses(coupee.client, "modele-test", prompt), /incomplete : max_output_tokens/);
  const ollama = fauxClient({ status: "completed", output_text: "Trois jo", usage: { input_tokens: 900, output_tokens: 1024 } });
  await assert.rejects(repondreAvecResponses(ollama.client, "modele-test", prompt, { max_output_tokens: 1024 }), /coupée par la limite/);
});

test("repondreAvecResponses signale un refus de sécurité du modèle", async () => {
  const { client } = fauxClient({
    status: "completed",
    output_text: "",
    output: [{ type: "message", content: [{ type: "refusal", refusal: "Je ne peux pas aider." }] }],
    usage: { input_tokens: 900, output_tokens: 5 },
  });
  await assert.rejects(repondreAvecResponses(client, "modele-test", prompt), /Refus du modèle : Je ne peux pas aider/);
});

test("repondreAvecResponses ajoute à la requête les réglages du modèle local", async () => {
  const { client, requetes } = fauxClient({ status: "completed", output_text: "Trois jours [1].", usage: { input_tokens: 900, output_tokens: 8 } });
  await repondreAvecResponses(client, "modele-test", prompt, { temperature: 0, reasoning: { effort: "none" }, max_output_tokens: 1024 });
  assert.equal(requetes[0].temperature, 0);
  assert.deepEqual(requetes[0].reasoning, { effort: "none" });
  assert.equal(requetes[0].max_output_tokens, 1024);
});

test("numerosCites garde chaque numéro une fois, dans l'ordre, et ignore ceux qui n'ont pas de passage", () => {
  assert.deepEqual(numerosCites("A [2]. B [1][2]. C [7].", prompt.passages), [1, 2]);
  assert.deepEqual(numerosCites("Je ne sais pas.", prompt.passages), []);
});
