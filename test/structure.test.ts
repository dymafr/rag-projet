// Tests de la réponse structurée : la validation par zod, le second essai, et la requête JSON envoyée à chaque API.
// Faux clients, ni clé ni réseau. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import { repondreAvecClaude } from "../src/generation/claude.ts";
import { repondreAvecResponses } from "../src/generation/openai.ts";
import type { PromptAugmente } from "../src/generation/prompt.ts";
import { repondreEnJson, valider } from "../src/generation/structure.ts";
import type { Resultat } from "../src/recherche/vectorielle.ts";

const passage = (id: string): Resultat => ({ id, document: id.split("#")[0], titres: ["Titre"], texte: "Trois jours par semaine.", score: 0.8 });
const prompt: PromptAugmente = { systeme: "Tu es Rhéa.", utilisateur: "<passages>…</passages>", passages: [passage("FAQ-RH#2")], ecartes: [], question: "Combien ?", date: "2026-10-05" };
const bonne = JSON.stringify({ reponse: "Trois jours [1].", sources: [{ passage: 1, citation: "Trois jours par semaine." }], confiance: "haute" });
const usage = { entree: 100, enCache: 0, sortie: 20 };

test("valider accepte un objet conforme et refuse le reste, avec la raison", () => {
  assert.equal(valider(bonne, 1).ok, true);
  assert.deepEqual(valider("Trois jours.", 1), { ok: false, erreur: "la réponse n'est pas du JSON valide" });
  const sansConfiance = valider(JSON.stringify({ reponse: "Trois jours.", sources: [] }), 1);
  assert.ok(!sansConfiance.ok && sansConfiance.erreur.includes("confiance"));
  const horsPassages = valider(bonne.replace('"passage":1', '"passage":4'), 1);
  assert.ok(!horsPassages.ok && horsPassages.erreur.includes("passage 4 inexistant"));
});

test("repondreEnJson fait un second essai en disant ce qui n'allait pas, et additionne les tokens", async () => {
  const consignes: (string | undefined)[] = [];
  const reponses = ["{ pas du JSON", bonne];
  const resultat = await repondreEnJson(async (consigne) => (consignes.push(consigne), { texte: reponses.shift()!, usage }), 1);
  assert.equal(resultat.essais, 2);
  assert.equal(resultat.reponse.confiance, "haute");
  assert.deepEqual(resultat.usage, { entree: 200, enCache: 0, sortie: 40 });
  assert.equal(consignes[0], undefined);
  assert.match(consignes[1]!, /invalide \(la réponse n'est pas du JSON valide\)/);
});

test("repondreEnJson abandonne après deux réponses invalides", async () => {
  await assert.rejects(repondreEnJson(async () => ({ texte: "{}", usage }), 1), /invalide après deux essais/);
});

test("en JSON, l'API Responses reçoit le schéma dans text.format, et la consigne du second essai à la fin du message", async () => {
  const requetes: Record<string, any>[] = [];
  const client = { responses: { create: async (r: Record<string, any>) => (requetes.push(r), { status: "completed", output: [], output_text: bonne, usage: {} }) } };
  await repondreAvecResponses(client as unknown as OpenAI, "modele-test", prompt, {}, { consigne: "Corrige." });
  assert.equal(requetes[0].text.format.type, "json_schema");
  assert.equal(requetes[0].text.format.name, "reponse_rhea");
  assert.equal(requetes[0].text.format.strict, true);
  assert.ok(requetes[0].input.endsWith("\n\nCorrige."));
});

test("en JSON, Claude reçoit les passages en texte, sans citations natives, et le schéma dans output_config", async () => {
  const requetes: Record<string, any>[] = [];
  const reponse = { content: [{ type: "text", text: bonne, citations: null }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 20 } };
  const client = { messages: { create: async (r: Record<string, any>) => (requetes.push(r), reponse) } };
  const { texte } = await repondreAvecClaude(client as unknown as Anthropic, "modele-test", prompt, {});
  assert.equal(texte, bonne);
  assert.deepEqual(requetes[0].messages[0].content, [{ type: "text", text: "<passages>…</passages>" }]);
  assert.equal(requetes[0].output_config.format.type, "json_schema");
});
