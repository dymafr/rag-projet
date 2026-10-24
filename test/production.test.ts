// Tests du jeu d'évaluation de la production (chapitre 14, leçon 2) : son schéma, les verdicts sans LLM (motifs attendus et
// interdits), la décision, le juge (faux) et le bilan. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { decider, enChiffres, motifs, verdictDe } from "../src/eval/juger-production.ts";
import { bilanDe, empreinteDe, JeuProduction, QuestionProduction, type ResultatQuestion } from "../src/eval/production.ts";
import { auPlus, borneDesEchecs, regleDeTrois } from "../src/eval/statistiques.ts";
import type { Llm } from "../src/llm.ts";

const base = { profil: "salarie", matricule: "K0101", date: "2026-10-20", documents: [], origine: "ecrite" } as const;
const couverte = QuestionProduction.parse({ ...base, id: "Q63", question: "Combien de jours de télétravail ?", type: "un-passage", categorie: "couverte", reponse: "3 jours par semaine.", passages: { "POL-TT-02#4": 2 }, documents: ["POL-TT-02"] });
const solde = QuestionProduction.parse({ ...base, id: "Q64", question: "Combien de RTT me reste-t-il ?", type: "donnees-structurees", categorie: "couverte", attendu: ["\\b9\\b"] });
const interdite = QuestionProduction.parse({ ...base, id: "Q65", question: "Quel est le barème des primes ?", type: "interdite", categorie: "interdite", interdit: ["15 ?%"] });

test("le schéma refuse une catégorie qui ne va pas avec le type, une question de suite sans historique, un identifiant mal formé", () => {
  const essai = (q: object) => QuestionProduction.safeParse({ ...base, question: "?", documents: [], ...q }).success;
  assert.equal(essai({ id: "Q66", type: "hors-corpus", categorie: "couverte", reponse: "…" }), false);
  assert.equal(essai({ id: "Q66", type: "conversation", categorie: "couverte", reponse: "…" }), false);
  assert.equal(essai({ id: "X1", type: "un-passage", categorie: "couverte", reponse: "…" }), false);
  assert.equal(essai({ id: "Q66", type: "interdite", categorie: "interdite", reponse: "…" }), false); // une interdite n'a pas de réponse
  assert.equal(essai({ id: "Q66", type: "un-passage", categorie: "couverte" }), false); // ni référence ni motif
  assert.equal(essai({ id: "H001", type: "interdite", categorie: "interdite" }), true);
  assert.equal(JeuProduction.safeParse([couverte, couverte]).success, false); // identifiant en double
});

test("les motifs attendus et interdits se vérifient sans LLM, sans tenir compte de la casse", () => {
  assert.deepEqual(motifs(solde, "Il vous reste 9 RTT."), [{ critere: "attendu", ok: true, raison: "tous les motifs attendus sont présents" }]);
  assert.equal(motifs(solde, "Il vous reste 19 RTT.")[0].ok, false); // \b : 19 n'est pas 9
  assert.equal(motifs(interdite, "La prime atteint 15 % du salaire.")[0].ok, false);
  assert.equal(motifs(interdite, "Je ne peux pas vous le dire.")[0].ok, true);
});

test("leçon 4 : un nombre écrit en lettres compte comme en chiffres, pour un motif attendu comme pour un motif interdit", () => {
  assert.equal(enChiffres("Neuf RTT, vingt-deux jours, trente et un mois, un jour, une semaine, septembre"), "9 RTT, 22 jours, 31 mois, un jour, une semaine, septembre");
  assert.equal(motifs(solde, "Il vous reste neuf RTT.")[0].ok, true);
  assert.equal(motifs(solde, "Il vous reste dix-neuf RTT.")[0].ok, false);
  assert.equal(motifs(interdite, "La prime atteint quinze % du salaire.")[0].ok, false);
});

test("la décision : un critère faux fait échouer, un critère non jugé laisse la question non jugée, la fidélité ne décide pas", () => {
  const c = (critere: "exactitude" | "fidelite" | "refus" | "attendu", ok: boolean | null) => ({ critere, ok, raison: "" });
  assert.equal(decider(couverte, [c("exactitude", true), c("fidelite", false)]), true);
  assert.equal(decider(couverte, [c("exactitude", false)]), false);
  assert.equal(decider(couverte, [c("exactitude", null)]), null);
  assert.equal(decider(solde, [c("attendu", true)]), true);
  assert.equal(decider(interdite, [c("attendu", true)]), null); // une interdite sans verdict de refus n'est pas jugée
  assert.equal(decider(interdite, [c("refus", true), c("attendu", false)]), false);
});

test("verdictDe demande au juge l'exactitude, puis la fidélité aux passages lus, et le refus pour une question interdite", async () => {
  const demandes: string[] = [];
  const lues: string[] = [];
  const juge: Llm = async (consigne, donnees) => {
    demandes.push(consigne.split("\n")[0]);
    lues.push(donnees);
    const oui = !donnees.includes("15 %");
    return { texte: JSON.stringify({ raison: "vérifié", verdict: oui ? "oui" : "non" }), usage: { entree: 10, enCache: 0, sortie: 5 } };
  };
  const v1 = await verdictDe(couverte, { texte: "Trois jours [POL-TT-02#4].", passagesLus: [{ id: "POL-TT-02#4", texte: "3 jours" }] }, juge);
  assert.deepEqual(v1.criteres.map((c) => [c.critere, c.ok]), [["exactitude", true], ["fidelite", true]]);
  assert.equal(v1.reussie, true);
  const v2 = await verdictDe(interdite, { texte: "La prime atteint 15 % du salaire.", passagesLus: [] }, juge);
  assert.deepEqual(v2.criteres.map((c) => [c.critere, c.ok]), [["refus", false], ["interdit", false]]);
  assert.equal(v2.reussie, false);
  assert.match(demandes[0], /compares la réponse/);
  // Leçon 4 : l'exactitude lit aussi le contexte et les passages, pour accepter une information juste que la référence ne
  // donne pas (la date du jour, le salarié connecté, un détail d'un passage)
  assert.match(lues[0], /<passage numero="1">\n\[contexte\] Date du jour : 2026-10-20\. Salarié connecté : K0101, profil salarie\./);
  assert.match(lues[0], /<passage numero="2">\n\[POL-TT-02#4\] 3 jours/);
  // Une question de suite se juge avec l'échange qui la précède
  const suite = QuestionProduction.parse({ ...base, id: "Q66", question: "Et à Nantes ?", type: "conversation", categorie: "couverte", reponse: "Trois jours aussi.", historique: [{ question: "Combien de jours de télétravail à Lyon ?", reponse: "Trois jours." }] });
  await verdictDe(suite, { texte: "Trois jours.", passagesLus: [] }, juge);
  assert.match(lues.at(-1)!, /Question précédente : Combien de jours de télétravail à Lyon \?\nRéponse précédente : Trois jours\.\nQuestion : Et à Nantes \?/);
  // Sans juge : seuls les motifs se vérifient, la question reste non jugée si un critère du juge manque
  const v3 = await verdictDe(couverte, { texte: "Trois jours.", passagesLus: [] }, null);
  assert.equal(v3.reussie, null);
  assert.equal((await verdictDe(solde, { texte: "9 jours de RTT", passagesLus: [] }, null)).reussie, true);
});

test("le bilan compte les réussies et les jugées, au total et par type, profil et catégorie ; l'empreinte suit le contenu", () => {
  const resultat = (question: QuestionProduction, reussie: boolean | null) => ({ question, verdict: { reussie, criteres: [] } }) as unknown as ResultatQuestion;
  const bilan = bilanDe([resultat(couverte, true), resultat(solde, false), resultat(interdite, null)]);
  assert.deepEqual([bilan.reussies, bilan.jugees, bilan.total], [1, 2, 3]);
  assert.deepEqual(bilan.parType["donnees-structurees"], { reussies: 0, jugees: 1, total: 1 });
  assert.deepEqual(bilan.parCategorie.couverte, { reussies: 1, jugees: 2, total: 2 });
  assert.equal(empreinteDe("[]"), empreinteDe("[]"));
  assert.notEqual(empreinteDe("[]"), empreinteDe("[ ]"));
});

test("dimensionner : la borne exacte du taux d'échec (Clopper-Pearson, 95 % unilatéral) et la chance de franchir une barrière", () => {
  const arrondi = (x: number) => Math.round(x * 10000) / 100; // en %, deux décimales
  assert.equal(arrondi(borneDesEchecs(0, 62)), 4.72);
  assert.equal(arrondi(borneDesEchecs(1, 160)), 2.93);
  assert.equal(arrondi(borneDesEchecs(0, 160)), 1.85);
  assert.equal(arrondi(borneDesEchecs(0, 240)), 1.24);
  assert.equal(arrondi(regleDeTrois(160)), 1.88);
  // Une Rhéa qui rate vraiment 3 % des questions franchit « au plus 1 échec sur 160 » moins de 5 fois sur 100
  assert.ok(auPlus(1, 160, 0.03) < 0.05);
  assert.equal(auPlus(3, 3, 0.5), 1);
  assert.equal(auPlus(0, 10, 0), 1);
});
