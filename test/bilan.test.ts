// Tests du bilan et de la comparaison de deux exécutions, sur un petit jeu écrit à la main. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { BilanRelu, comparerBilans, faireLeBilan } from "../src/eval/bilan.ts";
import type { FichierDeCitations } from "../src/eval/citations.ts";
import type { QuestionDeReference } from "../src/eval/jeu.ts";
import type { Jugements } from "../src/eval/juge.ts";
import { empreinte, type Enregistrement, type ReponseEnregistree } from "../src/eval/reponses.ts";
import { mcNemar } from "../src/eval/statistiques.ts";

const jeu: QuestionDeReference[] = [
  { id: "Q01", question: "Combien de jours de télétravail ?", categorie: "couverte", origine: "ecrite", reponse: "Trois.", passages: { "FAQ-RH#2": 2 } },
  { id: "Q02", question: "Quel plafond à Berlin ?", categorie: "couverte", origine: "synthetique", reponse: "Frais réels.", passages: { "GRP-TRV-01#10": 2 } },
  { id: "Q03", question: "Quelle météo demain ?", categorie: "hors-corpus", origine: "ecrite" },
];
const reponse = (id: string, texte: string, trouves: string[], abstention: ReponseEnregistree["abstention"] = null): ReponseEnregistree => ({
  id, question: "", date: "2026-10-08", trouves: trouves.map((t) => ({ id: t, score: 0.9 })), passages: [], texte, sources: [], abstention, duree: 1,
});
const enregistrement = (reponses: ReponseEnregistree[]): Enregistrement => ({
  date: "2026-10-08", llm: "ollama test", embeddings: "test", prompt: "v1", k: 8, budget: 1500, reponses,
});
// Les verdicts du juge : fidèle, et exacte ou non, pour chaque texte
const jugements = (exactes: Record<string, [string, boolean]>): Jugements => ({
  date: "2026-10-08", juge: "test", consignes: "abc", reponses: "",
  jugements: Object.entries(exactes).flatMap(([id, [texte, exacte]]) => [
    { id, empreinte: empreinte(texte), critere: "fidelite" as const, verdict: true, raison: "" },
    { id, empreinte: empreinte(texte), critere: "exactitude" as const, verdict: exacte, raison: "" },
  ]),
});
const citations = (id: string, texte: string): FichierDeCitations => ({
  date: "2026-10-08", juge: "test", consignes: "abc", reponses: "",
  resultats: [{ id, empreinte: empreinte(texte), phrases: [], rappel: 1, precision: 0.5, sansCitation: 0, sourceAttendue: true }],
});

test("le bilan rassemble récupération, verdicts, citations, abstention et questions réussies", () => {
  const b = faireLeBilan(
    jeu,
    enregistrement([reponse("Q01", "Trois jours [1].", ["FAQ-RH#2"]), reponse("Q02", "35 € [1].", ["FAQ-RH#19"]), reponse("Q03", "", [], "avant-llm")]),
    jugements({ Q01: ["Trois jours [1].", true], Q02: ["35 € [1].", false] }),
    citations("Q01", "Trois jours [1]."),
  );
  assert.equal(b.recuperation.n, 2); // seules les questions couvertes
  assert.equal(b.recuperation.succes, 0.5); // le passage qui répond est trouvé pour Q01, pas pour Q02
  assert.deepEqual(b.generation.exactitude, { oui: 1, n: 2 });
  assert.deepEqual(b.generation.pertinence, { oui: 0, n: 0 }); // pas de verdict de pertinence dans ce petit jeu
  assert.equal(b.citations.precision, 0.5);
  assert.deepEqual(b.reussite, { oui: 2, n: 3 }); // Q01 juste, Q03 abstention juste ; Q02 fausse
  assert.deepEqual(b.reussiteParOrigine, { ecrite: { oui: 2, n: 2 }, synthetique: { oui: 0, n: 1 } });
  assert.deepEqual(b.abstention.fuites, []);
  assert.equal(b.configuration.jeu, empreinte(JSON.stringify(jeu)));
});

test("un verdict ou un résultat de citations rendu pour un autre texte n'est pas compté", () => {
  const texte = "Trois jours, désormais [1].";
  const b = faireLeBilan(jeu, enregistrement([reponse("Q01", texte, ["FAQ-RH#2"])]), jugements({ Q01: ["Trois jours [1].", true] }), citations("Q01", "Trois jours [1]."));
  assert.deepEqual(b.generation.exactitude, { oui: 0, n: 0 });
  assert.equal(b.questions[0].citations, null);
  assert.equal(b.questions[0].reussie, false);
});

test("comparer deux bilans : questions gagnées et perdues, et test de McNemar", () => {
  const avant = faireLeBilan(jeu, enregistrement([reponse("Q01", "Trois [1].", []), reponse("Q02", "35 € [1].", []), reponse("Q03", "Il fera beau.", [])]),
    jugements({ Q01: ["Trois [1].", true], Q02: ["35 € [1].", false] }), citations("Q01", "Trois [1]."));
  const apres = faireLeBilan(jeu, enregistrement([reponse("Q01", "", [], "avant-llm"), reponse("Q02", "Frais réels [1].", []), reponse("Q03", "", [], "avant-llm")]),
    jugements({ Q02: ["Frais réels [1].", true] }), citations("Q02", "Frais réels [1]."));
  const c = comparerBilans(avant, apres);
  assert.deepEqual(c.gagnees, ["Q02", "Q03"]);
  assert.deepEqual(c.perdues, ["Q01"]);
});

test("une ligne de base abîmée ou d'un ancien format est refusée, pas comparée", () => {
  const b = faireLeBilan(jeu, enregistrement([reponse("Q01", "Trois [1].", ["FAQ-RH#2"]), reponse("Q03", "", [], "avant-llm")]),
    jugements({ Q01: ["Trois [1].", true] }), citations("Q01", "Trois [1]."));
  assert.ok(BilanRelu.safeParse(JSON.parse(JSON.stringify(b))).success);
  const renomme = { ...b, questions: b.questions.map(({ reussie, ...q }) => ({ ...q, reussi: reussie })) };
  assert.equal(BilanRelu.safeParse(renomme).success, false);
});

test("McNemar : 8 questions gagnées contre 2 perdues ne suffisent pas à conclure", () => {
  assert.ok(Math.abs(mcNemar(8, 2) - 0.109) < 1e-3); // 2 × (1 + 10 + 45) / 1024
  assert.equal(mcNemar(0, 0), 1);
  assert.equal(mcNemar(3, 0), 0.25);
  assert.ok(mcNemar(15, 2) < 0.05);
});
