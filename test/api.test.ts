// Tests de l'API en flux : les événements d'une question, le serveur HTTP, et le streaming de chaque API.
// Faux LLM et fausse recherche : ni clé, ni base, ni réseau. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import { repondreEnFlux, type Dependances, type Evenement } from "../src/api/rhea.ts";
import { creerServeur, evenementSSE } from "../src/api/serveur.ts";
import { streamerAvecClaude } from "../src/generation/claude.ts";
import type { GenerateurEnFlux, Morceau } from "../src/generation/generateur.ts";
import { streamerAvecResponses } from "../src/generation/openai.ts";
import type { PromptAugmente } from "../src/generation/prompt.ts";
import type { Resultat } from "../src/recherche/vectorielle.ts";

const faq: Resultat = { id: "FAQ-RH#2", document: "FAQ-RH", titres: ["FAQ RH de Kalyo", "Télétravail"], texte: "Jusqu'à trois jours par semaine.", score: 0.888 };
const usage = { entree: 900, enCache: 0, sortie: 12 };
const llm = (...morceaux: Morceau[]): GenerateurEnFlux =>
  async function* () {
    yield* morceaux;
  };
const dependances = (generer: GenerateurEnFlux, score = 0.888, budget = 1500): Dependances => ({
  chercher: async () => [{ ...faq, score }],
  generer,
  systeme: { version: "1", texte: "Tu es Rhéa.", empreinte: "abcd1234" },
  budget,
  date: () => "2026-10-05",
});
async function evenements(flux: AsyncGenerator<Evenement>) {
  const liste: Evenement[] = [];
  for await (const e of flux) liste.push(e);
  return liste;
}

test("evenementSSE écrit le nom, les données en JSON sur une ligne, puis une ligne vide", () => {
  assert.equal(evenementSSE("texte", { texte: "Trois" }), 'event: texte\ndata: {"texte":"Trois"}\n\n');
});

test("repondreEnFlux envoie le texte au fil de l'écriture, puis les sources citées, puis la fin", async () => {
  const generer = llm({ type: "texte", texte: "Trois jours " }, { type: "texte", texte: "[1]." }, { type: "fin", usage });
  const liste = await evenements(repondreEnFlux("Combien de jours ?", dependances(generer)));
  assert.deepEqual(liste.map((e) => e.nom), ["texte", "texte", "sources", "fin"]);
  assert.deepEqual(liste[2].donnees, [{ numero: 1, source: "FAQ-RH#2", titre: "FAQ RH de Kalyo > Télétravail", extraits: [] }]);
  assert.deepEqual(liste[3].donnees, { usage, prompt: "v1 abcd1234" });
});

test("repondreEnFlux s'abstient sans appeler le LLM sous le seuil, ou quand aucun passage ne tient dans le budget", async () => {
  let appels = 0;
  const generer: GenerateurEnFlux = async function* () {
    appels++;
  };
  const loin = await evenements(repondreEnFlux("Quelle météo ?", dependances(generer, 0.4)));
  assert.deepEqual(loin.map((e) => e.nom), ["abstention", "fin"]);
  const sansPassage = await evenements(repondreEnFlux("Combien de jours ?", dependances(generer, 0.888, 5)));
  assert.deepEqual(sansPassage.map((e) => e.nom), ["abstention", "fin"]);
  assert.equal(appels, 0);
});

test("repondreEnFlux demande de remplacer une réponse sans source vérifiable", async () => {
  const sansNumero = await evenements(repondreEnFlux("Rachat ?", dependances(llm({ type: "texte", texte: "Je ne sais pas." }, { type: "fin", usage }))));
  assert.deepEqual(sansNumero.map((e) => e.nom), ["texte", "sources", "abstention", "fin"]);
  const citationFausse = llm({ type: "texte", texte: "Quatre jours." }, { type: "citation", citation: { numero: 1, texteCite: "Quatre jours par semaine." } }, { type: "fin", usage });
  const liste = await evenements(repondreEnFlux("Combien ?", dependances(citationFausse)));
  assert.deepEqual(liste.map((e) => e.nom), ["texte", "sources", "abstention", "fin"]);
});

test("repondreEnFlux ignore une citation qui désigne un passage absent", async () => {
  const horsLimites = llm({ type: "texte", texte: "Trois jours [1]." }, { type: "citation", citation: { numero: 3, texteCite: "?" } }, { type: "fin", usage });
  const liste = await evenements(repondreEnFlux("Combien ?", dependances(horsLimites)));
  const sources = liste.find((e) => e.nom === "sources")!.donnees as { numero: number }[];
  assert.deepEqual(sources.map((s) => s.numero), [1]);
});

// Un serveur de test sur un port libre, arrêté à la fin
async function avecServeur(d: Dependances, essai: (adresse: string) => Promise<void>) {
  const serveur = creerServeur(d);
  await new Promise<void>((pret) => serveur.listen(0, "127.0.0.1", pret));
  try {
    await essai(`http://127.0.0.1:${(serveur.address() as AddressInfo).port}`);
  } finally {
    serveur.close();
  }
}
const ENTETES_JSON = { "Content-Type": "application/json" };

test("le serveur répond en flux à POST /ask, refuse une question vide et sert la page de chat", async () => {
  await avecServeur(dependances(llm({ type: "texte", texte: "Trois jours [1]." }, { type: "fin", usage })), async (adresse) => {
    const flux = await fetch(`${adresse}/ask`, { method: "POST", headers: ENTETES_JSON, body: JSON.stringify({ question: "Combien de jours ?" }) });
    assert.equal(flux.headers.get("content-type"), "text/event-stream");
    const corps = await flux.text();
    assert.ok(corps.startsWith('event: texte\ndata: {"texte":"Trois jours [1]."}\n\n'));
    assert.match(corps, /event: sources\n[\s\S]*event: fin\n/);
    const vide = await fetch(`${adresse}/ask`, { method: "POST", headers: ENTETES_JSON, body: JSON.stringify({ question: "  " }) });
    assert.equal(vide.status, 400);
    assert.deepEqual(await vide.json(), { erreur: "la question est vide" });
    assert.equal((await fetch(`${adresse}/ask`, { method: "POST", headers: ENTETES_JSON, body: "pas du JSON" })).status, 400);
    const page = await fetch(`${adresse}/`);
    assert.match(await page.text(), /<title>Rhéa/);
  });
});

test("le serveur refuse un corps qui n'est pas déclaré en JSON (415), comme celui qu'enverrait un autre site", async () => {
  await avecServeur(dependances(llm({ type: "fin", usage })), async (adresse) => {
    const reponse = await fetch(`${adresse}/ask`, { method: "POST", body: JSON.stringify({ question: "Combien ?" }) }); // envoyé en text/plain
    assert.equal(reponse.status, 415);
  });
});

test("le serveur garde le détail d'une erreur pour son terminal et envoie un message générique", async () => {
  const enPanne: GenerateurEnFlux = async function* () {
    throw new Error("401 Incorrect API key provided: sk-test-1234");
  };
  const journal = console.error;
  console.error = () => {}; // le serveur journalise l'erreur : on garde la sortie des tests lisible
  try {
    await avecServeur(dependances(enPanne), async (adresse) => {
      const corps = await (await fetch(`${adresse}/ask`, { method: "POST", headers: ENTETES_JSON, body: JSON.stringify({ question: "Combien ?" }) })).text();
      assert.match(corps, /event: erreur\ndata: \{"message":"Rhéa n'a pas pu terminer sa réponse/);
      assert.doesNotMatch(corps, /sk-test/);
    });
  } finally {
    console.error = journal;
  }
});

const prompt: PromptAugmente = { systeme: "Tu es Rhéa.", utilisateur: "…", passages: [faq], ecartes: [], question: "Combien ?", date: "2026-10-05" };
async function morceaux(flux: AsyncGenerator<Morceau>) {
  const liste: Morceau[] = [];
  for await (const m of flux) liste.push(m);
  return liste;
}
const clientOpenAI = (evenementsOpenAI: object[], appels: unknown[][] = []) =>
  ({ responses: { create: async (...args: unknown[]) => (appels.push(args), evenementsOpenAI) } }) as unknown as OpenAI;
const fin = (output_tokens: number) => ({ type: "response.completed", response: { usage: { input_tokens: 900, input_tokens_details: { cached_tokens: 0 }, output_tokens } } });

test("streamerAvecResponses demande un flux, passe le signal et rend les morceaux de texte puis la fin", async () => {
  const appels: unknown[][] = [];
  const evenementsOpenAI = [{ type: "response.output_text.delta", delta: "Trois" }, { type: "response.output_text.delta", delta: " jours [1]." }, fin(12)];
  const signal = new AbortController().signal;
  const liste = await morceaux(streamerAvecResponses(clientOpenAI(evenementsOpenAI, appels), "modele-test", prompt, {}, signal));
  assert.deepEqual(liste, [{ type: "texte", texte: "Trois" }, { type: "texte", texte: " jours [1]." }, { type: "fin", usage }]);
  assert.equal((appels[0][0] as { stream: boolean }).stream, true);
  assert.equal((appels[0][1] as { signal: AbortSignal }).signal, signal);
});

test("streamerAvecResponses signale un flux coupé avant la fin, une réponse coupée par la limite et un refus", async () => {
  const delta = { type: "response.output_text.delta", delta: "Trois" };
  await assert.rejects(morceaux(streamerAvecResponses(clientOpenAI([delta, delta]), "m", prompt)), /Flux interrompu/);
  await assert.rejects(morceaux(streamerAvecResponses(clientOpenAI([delta, fin(1024)]), "m", prompt, { max_output_tokens: 1024 })), /limite de tokens/);
  await assert.rejects(morceaux(streamerAvecResponses(clientOpenAI([{ type: "response.refusal.done", refusal: "Non." }]), "m", prompt)), /Refus du modèle : Non\./);
});

const clientClaude = (evenementsClaude: object[], message: object) =>
  ({ messages: { stream: () => ({ [Symbol.asyncIterator]: async function* () { yield* evenementsClaude; }, finalMessage: async () => message }) } }) as unknown as Anthropic;

test("streamerAvecClaude rend le texte, les citations, et [n] à la fin de chaque bloc cité", async () => {
  const evenementsClaude = [
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Trois jours." } },
    { type: "content_block_delta", index: 0, delta: { type: "citations_delta", citation: { type: "search_result_location", cited_text: "Jusqu'à trois jours par semaine.", search_result_index: 0 } } },
    { type: "content_block_stop", index: 0 },
  ];
  const client = clientClaude(evenementsClaude, { stop_reason: "end_turn", usage: { input_tokens: 900, output_tokens: 12 } });
  const liste = await morceaux(streamerAvecClaude(client, "modele-test", prompt));
  assert.deepEqual(liste, [
    { type: "texte", texte: "Trois jours." },
    { type: "citation", citation: { numero: 1, texteCite: "Jusqu'à trois jours par semaine." } },
    { type: "texte", texte: "[1]" },
    { type: "fin", usage },
  ]);
});

test("streamerAvecClaude signale un refus avec son explication", async () => {
  const client = clientClaude([], { stop_reason: "refusal", stop_details: { explanation: "contenu refusé" }, usage: { input_tokens: 900, output_tokens: 0 } });
  await assert.rejects(morceaux(streamerAvecClaude(client, "modele-test", prompt)), /Réponse interrompue : refusal \(contenu refusé\)/);
});
