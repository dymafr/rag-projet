// Tests de l'agent : la boucle avec un faux LLM qui suit un scénario, l'outil de recherche avec une fausse recherche, et la
// traduction de la conversation pour chaque API, avec de faux clients. Ni clé, ni base, ni réseau. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import { z } from "zod";
import { agir, executer, type Etape } from "../src/agent/boucle.ts";
import { chercherDocuments } from "../src/agent/chercher.ts";
import { agentClaude, lireReponseAgent, versClaude } from "../src/agent/claude.ts";
import type { LlmAgent, Message, ReponseAgent } from "../src/agent/llm-agent.ts";
import { definirOutil, schemaJson } from "../src/agent/outil.ts";
import { agentResponses, versResponses } from "../src/agent/responses.ts";
import { sourcesCitees } from "../src/agent/sources.ts";
import type { Resultat } from "../src/recherche/vectorielle.ts";

const usage = { entree: 100, enCache: 0, sortie: 10 };
const faq: Resultat = { id: "FAQ-RH#2", document: "FAQ-RH", titres: ["FAQ RH de Kalyo", "Télétravail"], texte: "Jusqu'à trois jours par semaine.", score: 0.888 };
const contexte = { date: "2026-10-13" };

// Un faux LLM : il rend, tour après tour, les réponses du scénario, et garde une copie de la conversation reçue
function fauxLlm(...scenario: Partial<ReponseAgent>[]) {
  const recus: Message[][] = [];
  const llm: LlmAgent = async (_systeme, messages) => {
    recus.push(structuredClone(messages));
    const suivante = scenario[recus.length - 1] ?? {};
    return { texte: "", appels: [], usage, brut: [], ...suivante };
  };
  return { llm, recus };
}
const recherche = chercherDocuments(async () => [faq]);
async function etapes(flux: AsyncGenerator<Etape>) {
  const liste: Etape[] = [];
  for await (const e of flux) liste.push(e);
  return liste;
}

test("agir exécute l'appel demandé, renvoie son résultat au LLM, puis rend sa réponse", async () => {
  const { llm, recus } = fauxLlm(
    { appels: [{ id: "a1", nom: "chercher_documents", arguments: { requete: "télétravail" } }] },
    { texte: "Trois jours par semaine [FAQ-RH#2]." },
  );
  const liste = await etapes(agir("Combien de jours ?", { llm, outils: [recherche], systeme: "Tu es Rhéa." }, contexte));
  assert.deepEqual(liste.map((e) => e.type), ["appel", "resultat", "reponse"]);
  assert.match(recus[0][0].role === "utilisateur" ? recus[0][0].texte : "", /^Date du jour : 2026-10-13\n\nQuestion : Combien de jours \?$/);
  const resultat = recus[1][2];
  assert.equal(resultat.role, "outil");
  assert.ok(resultat.role === "outil" && resultat.id === "a1" && resultat.texte.includes('source="FAQ-RH#2"'));
  const fin = liste.at(-1)!;
  assert.ok(fin.type === "reponse" && fin.tour === 2 && fin.usage.entree === 200);
});

test("agir répond sans outil quand le LLM ne demande rien", async () => {
  const { llm } = fauxLlm({ texte: "Je vous en prie." });
  const liste = await etapes(agir("Merci !", { llm, outils: [recherche], systeme: "" }, contexte));
  assert.deepEqual(liste.map((e) => e.type), ["reponse"]);
});

test("agir s'arrête après toursMax appels au LLM, même si le LLM demande encore", async () => {
  const encore = { appels: [{ id: "a", nom: "chercher_documents", arguments: { requete: "congés" } }] };
  const { llm, recus } = fauxLlm(encore, encore, encore);
  const liste = await etapes(agir("Question ?", { llm, outils: [recherche], systeme: "", toursMax: 2 }, contexte));
  assert.equal(recus.length, 2);
  assert.deepEqual(liste.at(-1), { type: "limite", tour: 2, usage: { entree: 200, enCache: 0, sortie: 20 } });
});

test("executer renvoie au LLM une erreur pour un outil inconnu ou des arguments refusés", async () => {
  const inconnu = await executer({ id: "x", nom: "supprimer_tout", arguments: {} }, [recherche], contexte);
  assert.ok(inconnu.erreur && /Outil inconnu : supprimer_tout\. Outils disponibles : chercher_documents/.test(inconnu.resultat.texte));
  const refuse = await executer({ id: "y", nom: "chercher_documents", arguments: { requete: 42 } }, [recherche], contexte);
  assert.ok(refuse.erreur && refuse.resultat.texte.startsWith("Arguments refusés"));
  const illisible = await executer({ id: "z", nom: "chercher_documents", arguments: "{requete:" }, [recherche], contexte);
  assert.ok(illisible.erreur);
});

test("executer garde hors du prompt la cause d'un outil qui échoue", async () => {
  const panne = definirOutil({ nom: "panne", description: "", parametres: z.object({}), executer: async () => { throw new Error("connexion refusée : 127.0.0.1:5433"); } });
  const { resultat, erreur, detail } = await executer({ id: "p", nom: "panne", arguments: {} }, [panne], contexte);
  assert.ok(erreur);
  assert.doesNotMatch(resultat.texte, /5433/);
  assert.equal(detail, "connexion refusée : 127.0.0.1:5433");
});

test("chercher_documents balise les passages par leur source, ou dit qu'aucun n'est assez proche", async () => {
  const { texte, passages } = await recherche.executer({ requete: "télétravail" }, contexte);
  assert.equal(passages?.length, 1);
  assert.match(texte, /^<passage source="FAQ-RH#2" titre="FAQ RH de Kalyo > Télétravail">/);
  const loin = chercherDocuments(async () => [{ ...faq, score: 0.418 }]);
  const vide = await loin.executer({ requete: "Merci" }, contexte);
  assert.deepEqual(vide.passages, []);
  assert.match(vide.texte, /meilleur score 0\.418, sous le seuil de 0\.49/);
});

test("schemaJson donne un JSON Schema strict : tous les champs requis, aucun champ en trop", () => {
  const schema = schemaJson(recherche);
  assert.equal(schema.$schema, undefined);
  assert.deepEqual(schema.required, ["requete"]);
  assert.equal(schema.additionalProperties, false);
  // Les bornes restent dans zod, pas dans le schéma envoyé : requete a .min(3).max(300)
  assert.deepEqual(Object.keys((schema.properties as Record<string, object>).requete), ["type", "description"]);
});

test("sourcesCitees sépare les sources rendues par un outil de celles que le LLM a inventées", () => {
  const { citees, inventees } = sourcesCitees("Trois jours [FAQ-RH#2]. Deux à Nantes [POL-TT-09#1][FAQ-RH#2].", [faq]);
  assert.deepEqual(citees.map((p) => p.id), ["FAQ-RH#2"]);
  assert.deepEqual(inventees, ["POL-TT-09#1"]);
});

// La même conversation pour les deux traductions : une question, une demande d'appel, son résultat
const conversation: Message[] = [
  { role: "utilisateur", texte: "Question : Combien de jours ?" },
  { role: "assistant", texte: "", appels: [{ id: "c1", nom: "chercher_documents", arguments: { requete: "télétravail" } }] },
  { role: "outil", id: "c1", nom: "chercher_documents", texte: "<passage …>", passages: [faq], erreur: false },
];

test("versResponses traduit la conversation en éléments function_call et function_call_output reliés par call_id", () => {
  assert.deepEqual(versResponses(conversation), [
    { role: "user", content: "Question : Combien de jours ?" },
    { type: "function_call", call_id: "c1", name: "chercher_documents", arguments: '{"requete":"télétravail"}' },
    { type: "function_call_output", call_id: "c1", output: "<passage …>" },
  ]);
  // La réponse brute de l'API repart telle quelle
  const brut = [{ type: "reasoning", id: "rs_1", encrypted_content: "…" }];
  assert.deepEqual(versResponses([{ role: "assistant", texte: "", appels: [], brut }]), brut);
});

test("agentResponses déclare les outils en mode strict, ne stocke rien et lit les demandes d'appel", async () => {
  const requetes: Record<string, any>[] = [];
  const reponse = {
    status: "completed",
    output_text: "",
    output: [{ type: "function_call", call_id: "c9", name: "chercher_documents", arguments: '{"requete":"RTT"}' }],
    usage: { input_tokens: 300, input_tokens_details: { cached_tokens: 0 }, output_tokens: 20 },
  };
  const client = { responses: { create: async (r: Record<string, any>) => (requetes.push(r), reponse) } } as unknown as OpenAI;
  const { appels } = await agentResponses(client, "modele-test")("Tu es Rhéa.", conversation.slice(0, 1), [recherche]);
  assert.deepEqual(appels, [{ id: "c9", nom: "chercher_documents", arguments: { requete: "RTT" } }]);
  assert.equal(requetes[0].instructions, "Tu es Rhéa.");
  assert.equal(requetes[0].store, false);
  assert.equal(requetes[0].tools[0].type, "function");
  assert.equal(requetes[0].tools[0].strict, true);
});

test("versClaude met les résultats d'un tour dans un seul message user, les passages en blocs search_result", () => {
  const deux: Message[] = [
    ...conversation.slice(0, 1),
    { role: "assistant", texte: "", appels: [{ id: "t1", nom: "chercher_documents", arguments: {} }, { id: "t2", nom: "inconnu", arguments: {} }] },
    { role: "outil", id: "t1", nom: "chercher_documents", texte: "…", passages: [faq], erreur: false },
    { role: "outil", id: "t2", nom: "inconnu", texte: "Outil inconnu", erreur: true },
  ];
  const messages = versClaude(deux);
  assert.deepEqual(messages.map((m) => m.role), ["user", "assistant", "user"]);
  const [t1, t2] = messages[2].content as Anthropic.ToolResultBlockParam[];
  assert.equal(t1.tool_use_id, "t1");
  assert.equal((t1.content as Anthropic.SearchResultBlockParam[])[0].type, "search_result");
  assert.deepEqual([t2.tool_use_id, t2.content, t2.is_error], ["t2", "Outil inconnu", true]);
});

test("lireReponseAgent lit les demandes d'appel et ajoute la source de chaque passage cité, une seule fois", () => {
  const blocs = [
    { type: "text", text: "Trois jours par semaine.", citations: [{ type: "search_result_location", source: "FAQ-RH#2", cited_text: "…" }] },
    { type: "text", text: " [FAQ-RH#2] Le manager les valide." }, // la même source, écrite aussi par Claude
    { type: "tool_use", id: "t3", name: "chercher_documents", input: { requete: "Nantes" } },
  ] as unknown as Anthropic.ContentBlock[];
  assert.deepEqual(lireReponseAgent(blocs), {
    texte: "Trois jours par semaine.[FAQ-RH#2] Le manager les valide.",
    appels: [{ id: "t3", nom: "chercher_documents", arguments: { requete: "Nantes" } }],
  });
});

test("agentClaude déclare les outils avec input_schema et refuse une réponse coupée", async () => {
  const requetes: Record<string, any>[] = [];
  const reponses = [
    { content: [{ type: "text", text: "Je vous en prie." }], stop_reason: "end_turn", usage: { input_tokens: 50, output_tokens: 5 } },
    { content: [], stop_reason: "max_tokens", usage: { input_tokens: 50, output_tokens: 4096 } },
  ];
  const client = { messages: { create: async (r: Record<string, any>) => (requetes.push(r), reponses[requetes.length - 1]) } } as unknown as Anthropic;
  const llm = agentClaude(client, "modele-test");
  const { texte } = await llm("Tu es Rhéa.", [{ role: "utilisateur", texte: "Merci !" }], [recherche]);
  assert.equal(texte, "Je vous en prie.");
  assert.equal(requetes[0].tools[0].name, "chercher_documents");
  assert.deepEqual(requetes[0].tools[0].input_schema.required, ["requete"]);
  await assert.rejects(llm("", [{ role: "utilisateur", texte: "?" }], [recherche]), /max_tokens/);
});
