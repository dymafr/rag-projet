// Tests de l'agent : la boucle avec un faux LLM qui suit un scénario, l'outil de recherche avec une fausse recherche, et la
// traduction de la conversation pour chaque API, avec de faux clients. Ni clé, ni base, ni réseau. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import { z } from "zod";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agir, DERNIER_TOUR, executer, RECHERCHE_INACHEVEE, type EntreeJournal, type Etape } from "../src/agent/boucle.ts";
import { journalJsonl } from "../src/agent/journal.ts";
import { chercherDocuments } from "../src/agent/chercher.ts";
import { agentClaude, lireReponseAgent, versClaude } from "../src/agent/claude.ts";
import type { LlmAgent, Message, OptionsAppel, ReponseAgent } from "../src/agent/llm-agent.ts";
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
  const options: (OptionsAppel | undefined)[] = [];
  const llm: LlmAgent = async (_systeme, messages, _outils, opts) => {
    recus.push(structuredClone(messages));
    options.push(opts);
    const suivante = scenario[recus.length - 1] ?? {};
    return { texte: "", appels: [], usage, brut: [], ...suivante };
  };
  return { llm, recus, options };
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

test("agir fait son dernier tour sans outil, et répond à la place d'un LLM qui demande encore", async () => {
  const encore = { texte: "Je vais vérifier.", appels: [{ id: "a", nom: "chercher_documents", arguments: { requete: "congés" } }] };
  const { llm, recus, options } = fauxLlm(encore, encore, encore);
  const liste = await etapes(agir("Question ?", { llm, outils: [recherche], systeme: "", toursMax: 2 }, contexte));
  assert.deepEqual(liste.map((e) => e.type), ["appel", "resultat", "limite", "reponse"]);
  assert.deepEqual(options.map((o) => o?.sansOutil), [false, true]);
  const consigne = recus[1].at(-1)!;
  assert.ok(consigne.role === "utilisateur" && consigne.texte === DERNIER_TOUR);
  assert.deepEqual(liste.at(-1), { type: "reponse", tour: 2, texte: RECHERCHE_INACHEVEE, usage: { entree: 200, enCache: 0, sortie: 20 } });
});

test("la recherche d'office se fait avant le premier tour, avec la question telle quelle", async () => {
  const { llm, recus } = fauxLlm({ texte: "Trois jours [FAQ-RH#2]." });
  const liste = await etapes(agir("Combien de jours ?", { llm, outils: [recherche], systeme: "", recherche: "office" as const }, contexte));
  assert.deepEqual(liste.map((e) => [e.type, e.tour]), [["appel", 0], ["resultat", 0], ["reponse", 1]]);
  assert.deepEqual(liste[0].type === "appel" && liste[0].appel.arguments, { requete: "Combien de jours ?" });
  // Le LLM reçoit la recherche comme s'il l'avait demandée : son appel, puis le résultat
  assert.deepEqual(recus[0].map((m) => m.role), ["utilisateur", "assistant", "outil"]);
});

test("la recherche de secours écarte une réponse donnée sans aucun outil, cherche, puis redemande au LLM", async () => {
  const { llm, recus } = fauxLlm({ texte: "Je ne traite que les questions RH." }, { texte: "Trois jours [FAQ-RH#2]." });
  const liste = await etapes(agir("Combien de jours ?", { llm, outils: [recherche], systeme: "", recherche: "secours" as const }, contexte));
  assert.deepEqual(liste.map((e) => [e.type, e.tour]), [["appel", 1], ["resultat", 1], ["reponse", 2]]);
  assert.ok(liste[0].type === "appel" && liste[0].appel.id === "recherche-de-secours");
  // La première réponse n'entre pas dans la conversation : le LLM voit la question, la recherche et son résultat
  assert.deepEqual(recus[1].map((m) => m.role), ["utilisateur", "assistant", "outil"]);
  const fin = liste.at(-1)!;
  assert.ok(fin.type === "reponse" && fin.usage.entree === 200); // les tokens de la réponse écartée comptent
});

test("la recherche imposée cherche la question autonome d'une question de suite", async () => {
  const { llm } = fauxLlm({ texte: "Dans l'espace RH." });
  const condenser = async (question: string) => `${question} (télétravail)`;
  const historique = [{ question: "Combien de jours de télétravail ?", reponse: "Trois." }];
  const liste = await etapes(agir("Et je les déclare où ?", { llm, outils: [recherche], systeme: "", recherche: "office" as const, condenser }, contexte, historique));
  assert.deepEqual(liste[0].type === "appel" && liste[0].appel.arguments, { requete: "Et je les déclare où ? (télétravail)" });
});

test("agir donne au LLM les échanges précédents, puis la date et la question", async () => {
  const { llm, recus } = fauxLlm({ texte: "Dans l'espace RH." });
  await etapes(agir("Et je les déclare où ?", { llm, outils: [recherche], systeme: "" }, contexte, [{ question: "Combien de jours ?", reponse: "Trois." }]));
  assert.deepEqual(recus[0].map((m) => m.role), ["utilisateur", "assistant", "utilisateur"]);
  assert.ok(recus[0][2].role === "utilisateur" && recus[0][2].texte.endsWith("Question : Et je les déclare où ?"));
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
  // La consigne du dernier tour rejoint le message des résultats, après eux
  const fin = versClaude([...deux, { role: "utilisateur", texte: DERNIER_TOUR }]);
  assert.equal(fin.length, 3);
  assert.deepEqual((fin[2].content as Anthropic.ContentBlockParam[]).map((b) => b.type), ["tool_result", "tool_result", "text"]);
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

// Leçon 5 : les garde-fous
const action = () => {
  const faits: string[] = [];
  const outil = definirOutil({
    nom: "envoyer",
    description: "",
    parametres: z.object({ texte: z.string() }),
    aConfirmer: ({ texte }) => `envoyer « ${texte} »`,
    executer: async ({ texte }) => (faits.push(texte), { texte: "Envoyé." }),
  });
  return { outil, faits };
};

test("un outil qui agit ne s'exécute qu'avec l'accord du salarié, et jamais sans personne pour le donner ; après un refus, la boucle répond elle-même", async () => {
  const appel = { id: "e", nom: "envoyer", arguments: { texte: "bonjour" } };
  const { outil, faits } = action();
  const sansPersonne = await executer(appel, [outil], contexte);
  const refus = await executer(appel, [outil], contexte, async () => false);
  assert.deepEqual([sansPersonne.statut, refus.statut, faits.length], ["refusé", "refusé", 0]);
  const resumes: string[] = [];
  const accord = await executer(appel, [outil], contexte, async (_a, resume) => (resumes.push(resume), true));
  assert.deepEqual([accord.statut, faits, resumes], ["ok", ["bonjour"], ["envoyer « bonjour »"]]);
  // Après un refus, la boucle répond elle-même, sans redonner la parole au LLM
  const { llm, recus } = fauxLlm({ appels: [appel] }, { texte: "C'est envoyé." });
  const liste = await etapes(agir("Envoie bonjour", { llm, outils: [outil], systeme: "" }, contexte));
  assert.deepEqual([liste.at(-1)?.type, liste.at(-1)?.tour, recus.length], ["reponse", 1, 1]);
});

test("agir limite les appels d'un même outil, puis journalise chaque appel avec son statut", async () => {
  const encore = { appels: [{ id: "a", nom: "chercher_documents", arguments: { requete: "congés" } }] };
  const { llm } = fauxLlm(encore, encore, encore, { texte: "Voilà." });
  const journal: EntreeJournal[] = [];
  const agent = { llm, outils: [recherche], systeme: "", appelsParOutil: 2, journaliser: async (e: EntreeJournal) => void journal.push(e) };
  const liste = await etapes(agir("Question ?", agent, { ...contexte, matricule: "K0101" }));
  const statuts = liste.flatMap((e) => (e.type === "resultat" ? [e.statut] : []));
  assert.deepEqual(statuts, ["ok", "ok", "limite"]);
  assert.deepEqual(journal.map((e) => [e.tour, e.outil, e.statut, e.matricule]), [
    [1, "chercher_documents", "ok", "K0101"],
    [2, "chercher_documents", "ok", "K0101"],
    [3, "chercher_documents", "limite", "K0101"],
  ]);
});

test("agir avance le dernier tour quand le budget de tokens est épuisé", async () => {
  const encore = { appels: [{ id: "a", nom: "chercher_documents", arguments: { requete: "congés" } }] };
  const { llm, options } = fauxLlm(encore, { texte: "Avec ce que j'ai : trois jours." });
  const liste = await etapes(agir("Question ?", { llm, outils: [recherche], systeme: "", tokensMax: 100 }, contexte));
  assert.deepEqual(liste.find((e) => e.type === "limite"), { type: "limite", tour: 2, raison: "tokens" });
  assert.deepEqual(options.map((o) => o?.sansOutil), [false, true]);
});

test("journalJsonl ajoute une ligne JSON par appel, dans le fichier du jour", async () => {
  const dossier = await mkdtemp(join(tmpdir(), "journal-"));
  const ecrire = journalJsonl(dossier);
  const entree: EntreeJournal = { horodatage: "2026-10-13T12:00:00.000Z", matricule: "K0101", tour: 1, outil: "consulter_solde", arguments: {}, statut: "ok", duree_ms: 3, resultat: "Solde…" };
  await ecrire(entree);
  await ecrire({ ...entree, tour: 2 });
  const lignes = (await readFile(join(dossier, "agent-2026-10-13.jsonl"), "utf8")).trim().split("\n");
  assert.deepEqual(lignes.map((l) => JSON.parse(l).tour), [1, 2]);
});
