// Tests de la vérification de la réponse (chapitre 14, leçon 4) : le vérificateur, puis la boucle de l'agent qui relance
// une fois une réponse non appuyée, et s'abstient si elle ne l'est toujours pas. Faux LLM : ni clé, ni réseau.
// Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { agir, type Etape } from "../src/agent/boucle.ts";
import { chercherDocuments } from "../src/agent/chercher.ts";
import type { LlmAgent, Message, ReponseAgent } from "../src/agent/llm-agent.ts";
import { normaliserCitations } from "../src/agent/sources.ts";
import { plancherPour } from "../src/generation/abstention.ts";
import { ABSTENTION_NON_APPUYEE, relance, verifierReponse, type Verification } from "../src/generation/verification.ts";
import type { Llm } from "../src/llm.ts";
import type { Resultat } from "../src/recherche/vectorielle.ts";
import { avecTrace, Trace } from "../src/trace/trace.ts";

const usage = { entree: 10, enCache: 0, sortie: 2 };
const passage: Resultat = { id: "POL-TT-02#4", document: "POL-TT-02", titres: ["Avenant"], texte: "Trois jours de télétravail par semaine.", score: 0.8 };

test("le vérificateur lit la réponse et les passages ; une affirmation importante non établie bloque, un détail non ; illisible, il ne bloque rien", async () => {
  const recus: string[] = [];
  const lu = (importante: boolean) =>
    JSON.stringify({ affirmations: [{ affirmation: "Trois jours", raison: "dit par le passage", appuyee: true, importante: true }, { affirmation: "Indemnité de 5 €", raison: "absente", appuyee: false, importante }] });
  const llm = (importante: boolean): Llm => async (_consigne, donnees) => (recus.push(donnees), { texte: lu(importante), usage });
  const v = await verifierReponse(llm(true), "Combien ?", "Trois jours [POL-TT-02#4], et une indemnité de 5 €.", [{ id: "POL-TT-02#4", texte: passage.texte }]);
  assert.equal(v.appuyee, false);
  assert.deepEqual(v.affirmations.map((a) => a.appuyee), [true, false]);
  assert.match(recus[0], /<passage source="POL-TT-02#4">/);
  assert.match(relance(v), /« Indemnité de 5 € » : absente/);
  assert.equal((await verifierReponse(llm(false), "Combien ?", "…", [])).appuyee, true); // un détail : la réponse est rendue
  const illisible = await verifierReponse(async () => ({ texte: "pas du JSON", usage }), "?", "…", []);
  assert.deepEqual([illisible.appuyee, illisible.illisible], [true, true]);
});

test("le plancher de similarité se mesure par modèle d'embedding ; sans mesure, aucun plancher", () => {
  assert.equal(plancherPour("transformers Xenova/bge-m3"), 0.4);
  assert.equal(plancherPour("openai text-embedding-3-small"), 0.3);
  assert.equal(plancherPour("voyage voyage-4"), 0);
});

test("une source recopiée avec un numéro de plus redevient celle du passage lu ; une source inconnue reste telle quelle", () => {
  const lus = new Set(["POL-TT-02#4"]);
  assert.equal(normaliserCitations("Trois jours [POL-TT-02#4-3], déclarés à l'avance [POL-TT-02#4.1] [FAQ-RH#2-1].", lus), "Trois jours [POL-TT-02#4], déclarés à l'avance [POL-TT-02#4] [FAQ-RH#2-1].");
});

// Un agent qui cherche, puis répond : d'abord avec une affirmation inventée, puis (selon le cas) corrigée
function scenario(secondeReponse: string) {
  const reponses: ReponseAgent[] = [
    { texte: "", appels: [{ id: "a1", nom: "chercher_documents", arguments: { requete: "télétravail" } }], usage, brut: [] },
    { texte: "Trois jours par semaine [POL-TT-02#4], avec une indemnité de 5 €.", appels: [], usage, brut: [] },
    { texte: secondeReponse, appels: [], usage, brut: [] },
  ];
  const recus: Message[][] = [];
  let i = 0;
  const llm: LlmAgent = async (_s, messages) => (recus.push(structuredClone(messages)), reponses[i++]);
  const verifier = async (_q: string, reponse: string): Promise<Verification> => {
    const inventee = reponse.includes("5 €");
    return { appuyee: !inventee, affirmations: [{ affirmation: inventee ? "indemnité de 5 €" : "trois jours", appuyee: !inventee, importante: true, raison: inventee ? "absente des passages" : "dit" }] };
  };
  const agent = { llm, outils: [chercherDocuments(async () => [passage])], systeme: "", recherche: "libre" as const, verifier };
  return { agent, recus };
}
async function reponseFinale(agent: ReturnType<typeof scenario>["agent"]) {
  const trace = new Trace();
  let fin: Etape | undefined;
  await avecTrace(trace, async () => {
    for await (const e of agir("Combien de jours de télétravail ?", agent, { date: "2026-10-20", profil: "salarie" })) if (e.type === "reponse") fin = e;
  });
  return { fin: fin as Extract<Etape, { type: "reponse" }>, trace };
}

test("une réponse non appuyée repart à l'agent avec ce qui ne va pas, et sa correction est rendue", async () => {
  const { agent, recus } = scenario("Trois jours par semaine [POL-TT-02#4].");
  const { fin, trace } = await reponseFinale(agent);
  assert.equal(fin.texte, "Trois jours par semaine [POL-TT-02#4].");
  const derniereConsigne = recus[2].at(-1)!;
  assert.equal(derniereConsigne.role, "utilisateur");
  assert.match((derniereConsigne as { texte: string }).texte, /indemnité de 5 €/);
  assert.deepEqual(trace.etapes.filter((e) => e.nom === "verification").map((e) => e.resume), ["0 affirmation appuyée sur 1, 1 importante non établie", "1 affirmation appuyée sur 1"]);
});

test("toujours non appuyée après la relance : Rhéa s'abstient plutôt que de rendre une information inventée", async () => {
  const { agent } = scenario("Trois jours par semaine [POL-TT-02#4], avec une indemnité de 5 €, j'insiste.");
  const { fin } = await reponseFinale(agent);
  assert.equal(fin.texte, ABSTENTION_NON_APPUYEE);
});
