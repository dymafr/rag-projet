// Tests du RAG géré d'OpenAI : les attributs et les filtres du vector store, puis la réponse avec file_search, avec un
// faux client qui note la requête. Ni clé, ni réseau. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import type OpenAI from "openai";
import type { ComparisonFilter, CompoundFilter } from "openai/resources/shared";
import { avecCitations, lireMarqueurs, poidsHybrides, repondreAvecFileSearch } from "../src/gere/file-search.ts";
import { attributsDe, filtreEnVigueur, horodatage, SANS_FIN, type Attributs, type Filtre } from "../src/gere/store.ts";
import type { Document } from "../src/ingestion/document.ts";
import { dateDeFin } from "../src/stockage/chunks.ts";

const doc = (id: string, type: "politique" | "accord", date_effet: string, liens: { remplace?: string; remplace_par?: string } = {}): Document => ({
  id,
  source: `${id}.md`,
  titre: id,
  texte: "…",
  metadonnees: { id, titre: id, type, date_effet, acces: "tous", langue: "fr", site: ["lyon", "nantes"], ...liens },
});
// L'accord de télétravail de 2024, remplacé le 1er mars 2026, et une politique jamais remplacée
const ancien = doc("POL-TT-01", "accord", "2024-01-01", { remplace_par: "POL-TT-02" });
const nouveau = doc("POL-TT-02", "accord", "2026-03-01", { remplace: "POL-TT-01" });
const notes = doc("POL-NF-01", "politique", "2026-01-01");
const parId = new Map([ancien, nouveau, notes].map((d) => [d.id, d]));
const attributs = [ancien, nouveau, notes].map((d) => attributsDe(d, dateDeFin(d, parId)));

// Ce que fait le service avec un filtre, rejoué en local pour vérifier le nôtre (seulement les opérateurs utilisés ici)
function passe(a: Attributs, f: Filtre): boolean {
  if (f.type === "and") return (f as CompoundFilter).filters.every((g) => passe(a, g as Filtre));
  const { key, type, value } = f as ComparisonFilter;
  const v = a[key];
  if (type === "lte") return v <= value;
  if (type === "gt") return v > value;
  if (type === "in") return (value as string[]).includes(String(v));
  throw new Error(`opérateur non rejoué : ${type}`);
}
const retenus = (f: Filtre) => attributs.filter((a) => passe(a, f)).map((a) => a.document);

test("attributsDe change les dates en horodatages, et donne une fin lointaine au texte jamais remplacé", () => {
  assert.deepEqual(attributs[0], { document: "POL-TT-01", type: "accord", debut: horodatage("2024-01-01"), fin: horodatage("2026-03-01") });
  assert.equal(attributs[1].fin, SANS_FIN);
  assert.equal(horodatage("2026-03-01"), 1772323200); // des secondes, pas des millisecondes
});

test("filtreEnVigueur retient la version qui s'appliquait ce jour-là, comme le filtre de la base", () => {
  assert.deepEqual(retenus(filtreEnVigueur("2026-01-15")), ["POL-TT-01", "POL-NF-01"]);
  assert.deepEqual(retenus(filtreEnVigueur("2026-10-16")), ["POL-TT-02", "POL-NF-01"]);
  assert.deepEqual(retenus(filtreEnVigueur("2026-03-01")), ["POL-TT-02", "POL-NF-01"]); // le jour du changement : le nouveau texte
  assert.deepEqual(retenus(filtreEnVigueur("2023-06-01")), []); // avant tout texte
  assert.deepEqual(retenus(filtreEnVigueur("2026-10-16", ["politique"])), ["POL-NF-01"]);
  assert.throws(() => filtreEnVigueur("15/01/2026"), /AAAA-MM-JJ/); // une date mal écrite est refusée avant tout appel
});

// Un faux client : il garde la requête reçue et renvoie la réponse qu'on lui donne
function fauxClient(reponse: object) {
  const requetes: Record<string, unknown>[] = [];
  const client = { responses: { create: async (requete: Record<string, unknown>) => (requetes.push(requete), { output: [], ...reponse }) } };
  return { client: client as unknown as OpenAI, requetes };
}

const reponseFileSearch = {
  status: "completed",
  usage: { input_tokens: 5200, input_tokens_details: { cached_tokens: 0 }, output_tokens: 60 },
  output: [
    {
      type: "file_search_call",
      id: "fs_1",
      status: "completed",
      queries: ["nombre de jours de télétravail par semaine"],
      results: [
        { file_id: "file-a", filename: "POL-TT-02.md", score: 0.91, text: "Le télétravail est possible trois jours par semaine.", attributes: { document: "POL-TT-02", type: "accord" } },
        { file_id: "file-b", filename: "FAQ-RH.md", score: 0.62, text: "Combien de jours de télétravail ?", attributes: { document: "FAQ-RH", type: "faq" } },
      ],
    },
    {
      type: "message",
      role: "assistant",
      content: [
        { type: "output_text", text: "Trois jours par semaine.", annotations: [{ type: "file_citation", file_id: "file-a", filename: "POL-TT-02.md", index: 24 }] },
        { type: "output_text", text: " Demandez-le à votre manager.", annotations: [{ type: "file_citation", file_id: "file-b", filename: "FAQ-RH.md", index: 29 }] },
      ],
    },
  ],
};

test("repondreAvecFileSearch déclare l'outil avec le store, le filtre et les réglages, demande les passages et ne stocke rien", async () => {
  const { client, requetes } = fauxClient(reponseFileSearch);
  const filtres = filtreEnVigueur("2026-10-16");
  const historique = [{ question: "Je suis à Lyon.", reponse: "Très bien." }];
  await repondreAvecFileSearch(
    client,
    "modele-test",
    { systeme: "Tu es Rhéa.", question: "Combien de jours ?", date: "2026-10-16", historique, store: "vs_test", filtres },
    { k: 8, seuil: 0.4, hybride: { embedding_weight: 0.7, text_weight: 0.3 } },
  );
  const r = requetes[0];
  assert.deepEqual(r.tools, [
    {
      type: "file_search",
      vector_store_ids: ["vs_test"],
      max_num_results: 8,
      filters: filtres,
      ranking_options: { ranker: "auto", score_threshold: 0.4, hybrid_search: { embedding_weight: 0.7, text_weight: 0.3 } },
    },
  ]);
  assert.deepEqual(r.include, ["file_search_call.results"]);
  assert.equal(r.store, false);
  assert.equal(r.instructions, "Tu es Rhéa.");
  assert.deepEqual(r.input, [
    { role: "user", content: "Je suis à Lyon." },
    { role: "assistant", content: "Très bien." },
    { role: "user", content: "Date du jour : 2026-10-16\n\nQuestion : Combien de jours ?" },
  ]);
});

test("repondreAvecFileSearch lit les requêtes, les passages, les citations et les tokens", async () => {
  const { client } = fauxClient(reponseFileSearch);
  const r = await repondreAvecFileSearch(client, "modele-test", { systeme: "…", question: "…", date: "2026-10-16", store: "vs_test" }, { k: 8 });
  assert.deepEqual(r.requetes, ["nombre de jours de télétravail par semaine"]);
  assert.deepEqual(r.passages.map((p) => [p.document, p.score]), [["POL-TT-02", 0.91], ["FAQ-RH", 0.62]]);
  assert.equal(r.texte, "Trois jours par semaine. Demandez-le à votre manager.");
  // La seconde citation est relative à son morceau de texte : on la décale de la longueur du premier
  assert.deepEqual(r.citations, [{ document: "POL-TT-02", index: 24 }, { document: "FAQ-RH", index: 53 }]);
  assert.equal(r.recherches, 1);
  assert.deepEqual(r.usage, { entree: 5200, enCache: 0, sortie: 60 });
  assert.equal(avecCitations(r.texte, r.citations), "Trois jours par semaine.[POL-TT-02] Demandez-le à votre manager.[FAQ-RH]");
});

test("repondreAvecFileSearch refuse une réponse incomplète ou un refus du modèle", async () => {
  const coupee = fauxClient({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } });
  await assert.rejects(repondreAvecFileSearch(coupee.client, "m", { systeme: "…", question: "…", date: "2026-10-16", store: "vs" }, { k: 8 }), /incomplete : max_output_tokens/);
  const refus = fauxClient({ status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "Non." }] }] });
  await assert.rejects(repondreAvecFileSearch(refus.client, "m", { systeme: "…", question: "…", date: "2026-10-16", store: "vs" }, { k: 8 }), /Refus du modèle : Non\./);
});

test("avecCitations insère chaque source une fois par position, sans décaler les autres", () => {
  const citations = [
    { document: "A", index: 5 },
    { document: "B", index: 5 },
    { document: "A", index: 5 },
    { document: "C", index: 11 },
  ];
  assert.equal(avecCitations("Un. Deux. Trois.", citations), "Un. D[A][B]eux. T[C]rois.");
  assert.equal(avecCitations("Sans source.", []), "Sans source.");
});

test("poidsHybrides arrondit le poids des embeddings : 1 - 0.7 ne vaut pas exactement 0.3 en JavaScript", () => {
  assert.notEqual(1 - 0.7, 0.3);
  assert.deepEqual(poidsHybrides(0.7), { embedding_weight: 0.3, text_weight: 0.7 });
  assert.deepEqual(poidsHybrides(0), { embedding_weight: 1, text_weight: 0 });
});

test("lireMarqueurs retire les marqueurs bruts du texte et les lit comme des citations du N-ième passage", () => {
  const passages = ["POL-HO-01", "POL-CA-01", "FAQ-RH"].map((document) => ({ document, score: 0.6, texte: "…" }));
  const brut = "Dix jours par an. \uE200filecite\uE202turn0file0\uE202turn0file1\uE201 Fin.";
  const { texte, citations, decaler } = lireMarqueurs(brut, [passages]);
  assert.equal(texte, "Dix jours par an.  Fin.");
  assert.deepEqual(citations, [{ document: "POL-HO-01", index: 18 }, { document: "POL-CA-01", index: 18 }]);
  assert.equal(avecCitations(texte, citations), "Dix jours par an. [POL-HO-01][POL-CA-01] Fin.");
  assert.equal(decaler(brut.length), texte.length); // une position après le marqueur recule de sa longueur
  assert.equal(lireMarqueurs("Sans marqueur.", [passages]).texte, "Sans marqueur.");
});

test("lireMarqueurs lit turnKfileN dans le K-ième appel de l'outil, et retire un marqueur d'une autre forme", () => {
  const p = (document: string) => ({ document, score: 0.6, texte: "…" });
  const parAppel = [[p("POL-TT-02")], [p("POL-NF-01"), p("FAQ-RH")]];
  const brut = "Trois jours.\uE200filecite\uE202turn0file0\uE201 Cent trente euros.\uE200filecite\uE202turn1file0\uE201\uE200cite\uE202turn0search2\uE201";
  const { texte, citations } = lireMarqueurs(brut, parAppel);
  assert.equal(texte, "Trois jours. Cent trente euros.");
  assert.equal(avecCitations(texte, citations), "Trois jours.[POL-TT-02] Cent trente euros.[POL-NF-01]");
});

test("repondreAvecFileSearch lit les citations écrites en marqueurs bruts quand il n'y a pas d'annotation", async () => {
  const { client } = fauxClient({
    status: "completed",
    usage: { input_tokens: 8000, output_tokens: 90 },
    output: [
      { type: "file_search_call", id: "fs_1", status: "completed", queries: ["RTT"], results: [{ filename: "POL-CA-01.md", score: 0.7, text: "Dix RTT.", attributes: { document: "POL-CA-01" } }] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "Dix jours. \uE200filecite\uE202turn0file0\uE201", annotations: [] }] },
    ],
  });
  const r = await repondreAvecFileSearch(client, "m", { systeme: "…", question: "…", date: "2026-10-16", store: "vs" }, { k: 8 });
  assert.equal(r.texte, "Dix jours. ");
  assert.equal(r.marqueurs, 1);
  assert.equal(avecCitations(r.texte, r.citations).trim(), "Dix jours. [POL-CA-01]");
});
