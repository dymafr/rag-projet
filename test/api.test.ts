// Tests de l'API en flux : les événements d'une question, le serveur HTTP, et le streaming de chaque API.
// Faux LLM et fausse recherche : ni clé, ni base, ni réseau. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import { repondreEnFlux, type Dependances, type Evenement } from "../src/api/rhea.ts";
import { creerServeur, evenementSSE, type DependancesServeur } from "../src/api/serveur.ts";
import { streamerAvecClaude } from "../src/generation/claude.ts";
import type { GenerateurEnFlux, Morceau } from "../src/generation/generateur.ts";
import { streamerAvecResponses } from "../src/generation/openai.ts";
import type { PromptAugmente } from "../src/generation/prompt.ts";
import type { Profil } from "../src/recherche/droits.ts";
import type { Resultat } from "../src/recherche/vectorielle.ts";

const faq: Resultat = { id: "FAQ-RH#2", document: "FAQ-RH", titres: ["FAQ RH de Kalyo", "Télétravail"], texte: "Jusqu'à trois jours par semaine.", score: 0.888 };
const usage = { entree: 900, enCache: 0, sortie: 12 };
const llm = (...morceaux: Morceau[]): GenerateurEnFlux =>
  async function* () {
    yield* morceaux;
  };
// Un annuaire de test : deux salariés connus (chapitre 13)
const ANNUAIRE: Record<string, Profil> = { K0101: "salarie", K0035: "manager" };
const dependances = (generer: GenerateurEnFlux, score = 0.888, budget = 1500): DependancesServeur => ({
  chercher: async () => [{ ...faq, score }],
  profil: async (matricule) => ANNUAIRE[matricule] ?? null,
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
  const liste = await evenements(repondreEnFlux("Combien de jours ?", "salarie", dependances(generer)));
  assert.deepEqual(liste.map((e) => e.nom), ["texte", "texte", "sources", "fin"]);
  assert.deepEqual(liste[2].donnees, [{ numero: 1, source: "FAQ-RH#2", titre: "FAQ RH de Kalyo > Télétravail", extraits: [] }]);
  assert.deepEqual(liste[3].donnees, { usage, prompt: "v1 abcd1234" });
});

test("repondreEnFlux s'abstient sans appeler le LLM sous le seuil, ou quand aucun passage ne tient dans le budget", async () => {
  let appels = 0;
  const generer: GenerateurEnFlux = async function* () {
    appels++;
  };
  const loin = await evenements(repondreEnFlux("Quelle météo ?", "salarie", dependances(generer, 0.4)));
  assert.deepEqual(loin.map((e) => e.nom), ["abstention", "fin"]);
  const sansPassage = await evenements(repondreEnFlux("Combien de jours ?", "salarie", dependances(generer, 0.888, 5)));
  assert.deepEqual(sansPassage.map((e) => e.nom), ["abstention", "fin"]);
  assert.equal(appels, 0);
});

test("repondreEnFlux demande de remplacer une réponse sans source vérifiable", async () => {
  const sansNumero = await evenements(repondreEnFlux("Rachat ?", "salarie", dependances(llm({ type: "texte", texte: "Je ne sais pas." }, { type: "fin", usage }))));
  assert.deepEqual(sansNumero.map((e) => e.nom), ["texte", "sources", "abstention", "fin"]);
  const citationFausse = llm({ type: "texte", texte: "Quatre jours." }, { type: "citation", citation: { numero: 1, texteCite: "Quatre jours par semaine." } }, { type: "fin", usage });
  const liste = await evenements(repondreEnFlux("Combien ?", "salarie", dependances(citationFausse)));
  assert.deepEqual(liste.map((e) => e.nom), ["texte", "sources", "abstention", "fin"]);
});

test("repondreEnFlux ignore une citation qui désigne un passage absent", async () => {
  const horsLimites = llm({ type: "texte", texte: "Trois jours [1]." }, { type: "citation", citation: { numero: 3, texteCite: "?" } }, { type: "fin", usage });
  const liste = await evenements(repondreEnFlux("Combien ?", "salarie", dependances(horsLimites)));
  const sources = liste.find((e) => e.nom === "sources")!.donnees as { numero: number }[];
  assert.deepEqual(sources.map((s) => s.numero), [1]);
});

test("repondreEnFlux condense une question de suite, cherche la question autonome et l'annonce à la page", async () => {
  let cherchee = "";
  const d: DependancesServeur = {
    ...dependances(llm({ type: "texte", texte: "Huit jours [1]." }, { type: "fin", usage })),
    chercher: async (question) => {
      cherchee = question;
      return [faq];
    },
    condenser: async () => "Combien de RTT ai-je par an à 80 % ?",
  };
  const historique = [{ question: "Combien de RTT ai-je par an ?", reponse: "10 jours pour un temps plein [1]." }];
  const liste = await evenements(repondreEnFlux("Et à 80 % ?", "salarie", d, undefined, historique));
  assert.deepEqual(liste[0], { nom: "question", donnees: { question: "Combien de RTT ai-je par an à 80 % ?" } });
  assert.equal(cherchee, "Combien de RTT ai-je par an à 80 % ?");
  // Sans historique, aucune condensation : la question est cherchée telle quelle, sans événement question
  const seule = await evenements(repondreEnFlux("Combien de RTT ai-je par an ?", "salarie", d));
  assert.equal(cherchee, "Combien de RTT ai-je par an ?");
  assert.ok(!seule.some((e) => e.nom === "question"));
});

// Un serveur de test sur un port libre, arrêté à la fin
async function avecServeur(d: DependancesServeur, essai: (adresse: string) => Promise<void>) {
  const serveur = creerServeur(d);
  await new Promise<void>((pret) => serveur.listen(0, "127.0.0.1", pret));
  try {
    await essai(`http://127.0.0.1:${(serveur.address() as AddressInfo).port}`);
  } finally {
    serveur.close();
  }
}
const ENTETES_JSON = { "Content-Type": "application/json", "X-Matricule": "K0101" }; // le salarié connecté (chapitre 13)

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

test("le serveur transmet l'historique de la conversation, et refuse un historique mal formé ou trop long", async () => {
  let recu: unknown;
  const d: DependancesServeur = { ...dependances(llm({ type: "texte", texte: "Huit jours [1]." }, { type: "fin", usage })), condenser: async (q, h) => ((recu = h), q) };
  await avecServeur(d, async (adresse) => {
    const historique = [{ question: "Combien de RTT ?", reponse: "10 jours." }];
    const ok = await fetch(`${adresse}/ask`, { method: "POST", headers: ENTETES_JSON, body: JSON.stringify({ question: "Et à 80 % ?", historique }) });
    await ok.text();
    assert.deepEqual(recu, historique);
    const mal = await fetch(`${adresse}/ask`, { method: "POST", headers: ENTETES_JSON, body: JSON.stringify({ question: "Et ?", historique: [{ question: "?" }] }) });
    assert.deepEqual([mal.status, await mal.json()], [400, { erreur: "historique : chaque réponse doit être un texte" }]);
    const vide = await fetch(`${adresse}/ask`, { method: "POST", headers: ENTETES_JSON, body: JSON.stringify({ question: "Et ?", historique: [{ question: " ", reponse: "…" }] }) });
    assert.deepEqual(await vide.json(), { erreur: "historique : une question est vide" });
    const long = Array.from({ length: 4 }, () => ({ question: "Combien ?", reponse: "…" }));
    const tropLong = await fetch(`${adresse}/ask`, { method: "POST", headers: ENTETES_JSON, body: JSON.stringify({ question: "Et ?", historique: long }) });
    assert.deepEqual(await tropLong.json(), { erreur: "historique trop long : 3 échanges au plus" });
  });
});

test("le serveur exige le salarié connecté (401), refuse un matricule inconnu (403) et cherche avec le profil de l'annuaire", async () => {
  const profils: Profil[] = [];
  const d: DependancesServeur = {
    ...dependances(llm({ type: "texte", texte: "Trois jours [1]." }, { type: "fin", usage })),
    chercher: async (_question, _date, profil) => (profils.push(profil), [faq]),
  };
  await avecServeur(d, async (adresse) => {
    const poser = (entetes: Record<string, string>, corps: object = { question: "Combien de jours ?" }) =>
      fetch(`${adresse}/ask`, { method: "POST", headers: { "Content-Type": "application/json", ...entetes }, body: JSON.stringify(corps) });
    assert.equal((await poser({})).status, 401);
    assert.equal((await poser({ "X-Matricule": "Morgane" })).status, 401);
    assert.equal((await poser({ "X-Matricule": "K9999" })).status, 403);
    // Le client ne choisit pas son profil : une clé de plus dans le corps est refusée
    assert.equal((await poser({ "X-Matricule": "K0101" }, { question: "Combien ?", profil: "rh" })).status, 400);
    await (await poser({ "X-Matricule": "K0035" })).text();
    await (await poser({ "X-Matricule": "K0101" })).text();
    assert.deepEqual(profils, ["manager", "salarie"]); // aucune recherche pour les demandes refusées
  });
});

test("le serveur refuse un corps qui n'est pas déclaré en JSON (415), comme celui qu'enverrait un autre site", async () => {
  await avecServeur(dependances(llm({ type: "fin", usage })), async (adresse) => {
    const reponse = await fetch(`${adresse}/ask`, { method: "POST", body: JSON.stringify({ question: "Combien ?" }) }); // envoyé en text/plain
    assert.equal(reponse.status, 415);
  });
});

test("le serveur garde le détail d'une erreur pour son terminal, caviardé, et envoie un message générique", async () => {
  const cle = `sk-proj-${"Ab3".repeat(16)}`; // une fausse clé, assemblée ici pour ne pas alerter les scanners de secrets
  const enPanne: GenerateurEnFlux = async function* () {
    throw new Error(`401 Incorrect API key provided: ${cle}`);
  };
  const journal = console.error;
  const terminal: string[] = [];
  console.error = (...args: unknown[]) => void terminal.push(args.join(" ")); // ce que le serveur écrit dans son terminal
  try {
    await avecServeur(dependances(enPanne), async (adresse) => {
      const corps = await (await fetch(`${adresse}/ask`, { method: "POST", headers: ENTETES_JSON, body: JSON.stringify({ question: "Combien ?" }) })).text();
      assert.match(corps, /event: erreur\ndata: \{"message":"Rhéa n'a pas pu terminer sa réponse/);
      assert.doesNotMatch(corps, /sk-proj/);
    });
    // La lecture du profil peut échouer aussi : même règle
    const annuaireEnPanne = { ...dependances(enPanne), profil: async () => { throw new Error(`annuaire injoignable, clé ${cle}`); } };
    await avecServeur(annuaireEnPanne, async (adresse) => {
      const reponse = await fetch(`${adresse}/ask`, { method: "POST", headers: ENTETES_JSON, body: JSON.stringify({ question: "Combien ?" }) });
      assert.equal(reponse.status, 500);
      assert.doesNotMatch(await reponse.text(), /sk-proj/);
    });
  } finally {
    console.error = journal;
  }
  // Chapitre 13 : le terminal garde la cause, pas la clé
  assert.match(terminal.join("\n"), /401 Incorrect API key provided: \[secret retiré\]/);
  assert.match(terminal.join("\n"), /annuaire injoignable, clé \[secret retiré\]/);
  assert.ok(!terminal.join("\n").includes(cle));
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
