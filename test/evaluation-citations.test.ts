// Tests de l'évaluation des citations et de l'abstention, sur des exemples calculés à la main. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { type Cas, tableauAbstention } from "../src/eval/abstention.ts";
import { decouperEnPhrases, evaluerCitations } from "../src/eval/citations.ts";

test("une réponse se découpe en phrases, chacune avec les passages qu'elle cite", () => {
  assert.deepEqual(decouperEnPhrases("Trois jours par semaine [1][2]. Déclarez-les dans l'espace RH [2][2]. Merci !"), [
    { texte: "Trois jours par semaine.", numeros: [1, 2] },
    { texte: "Déclarez-les dans l'espace RH.", numeros: [2] },
    { texte: "Merci !", numeros: [] },
  ]);
});

test("les numéros placés après le point, ou groupés, restent avec leur phrase", () => {
  const attendu = [
    { texte: "Trois jours par semaine.", numeros: [1] },
    { texte: "Déclarez-les dans l'espace RH.", numeros: [2, 3] },
  ];
  // À la manière de Claude, qui ajoute le numéro à la fin de chaque bloc cité
  assert.deepEqual(decouperEnPhrases("Trois jours par semaine.[1] Déclarez-les dans l'espace RH.[2][3]"), attendu);
  assert.deepEqual(decouperEnPhrases("Trois jours par semaine. [1] Déclarez-les dans l'espace RH. [2][3]"), attendu);
  assert.deepEqual(decouperEnPhrases("Trois jours par semaine [1]. Déclarez-les dans l'espace RH [2, 3]."), attendu);
});

test("rappel et précision des citations : l'exemple d'ALCE", async () => {
  // Phrase un cite [2], qui l'établit. Phrase deux cite [1][3] : [3] seul suffit, [1] seul n'établit rien,
  // donc [1] est inutile. Phrase trois cite [4], qui ne l'établit pas
  const etablit: Record<string, (numeros: number[]) => boolean> = {
    "Phrase un.": (n) => n.includes(2),
    "Phrase deux.": (n) => n.includes(3),
    "Phrase trois.": () => false,
  };
  let appels = 0;
  const r = await evaluerCitations("Phrase un [2]. Phrase deux [1][3]. Phrase trois [4].", async (phrase, numeros) => {
    appels++;
    return etablit[phrase](numeros);
  });
  assert.deepEqual(r.phrases.map((p) => [p.appuyee, p.utiles]), [[true, [true]], [true, [false, true]], [false, [false]]]);
  assert.ok(Math.abs(r.rappel! - 2 / 3) < 1e-9); // deux phrases établies sur trois
  assert.equal(r.precision, 0.5); // deux citations utiles sur quatre
  // Phrase deux : [1][3], [1] seul, puis [3] seul ; les questions suivantes sont déjà posées. Soit 1 + 3 + 1 appels
  assert.equal(appels, 5);
});

test("une phrase qui ne cite rien compte comme non établie dans le rappel, comme dans ALCE", async () => {
  const r = await evaluerCitations("Trois jours [1]. Le plafond est de 45 €. Le délai est de 30 jours.", async () => true);
  assert.ok(Math.abs(r.rappel! - 1 / 3) < 1e-9);
  assert.equal(r.precision, 1); // la seule citation est utile
  assert.equal(r.sansCitation, 2);
  const aucune = await evaluerCitations("Je ne trouve pas cette information.", async () => true);
  assert.equal(aucune.rappel, 0);
  assert.equal(aucune.precision, null); // aucune citation : pas de précision
});

// n cas identiques, numérotés à partir de debut
const cas = (n: number, debut: number, modele: Omit<Cas, "id">): Cas[] =>
  Array.from({ length: n }, (_, i) => ({ id: `Q${debut + i}`, ...modele }));

test("le tableau d'abstention : les cinq cas et les deux taux d'erreur", () => {
  // 40 questions couvertes, 30 sans réponse dans les documents (20 hors corpus, 10 interdites)
  const t = tableauAbstention([
    ...cas(30, 1, { categorie: "couverte", abstention: null, exacte: true }),
    ...cas(4, 31, { categorie: "couverte", abstention: null, exacte: false }),
    ...cas(6, 35, { categorie: "couverte", abstention: "sans-source" }),
    ...cas(5, 41, { categorie: "hors-corpus", abstention: null }),
    ...cas(15, 46, { categorie: "hors-corpus", abstention: "avant-llm" }),
    ...cas(10, 61, { categorie: "interdite", abstention: "avant-llm" }),
  ]);
  assert.deepEqual([t.justes, t.fausses, t.abstentionsATort, t.reponsesATort, t.abstentionsJustes], [30, 4, 6, 5, 25]);
  assert.ok(Math.abs(t.tauxReponsesATort! - 5 / 30) < 1e-9); // 16,7 %
  assert.equal(t.tauxAbstentionsATort, 0.15); // 6 sur 40
  assert.equal(t.couverture, 0.85); // 34 sur 40
  assert.ok(Math.abs(t.exactitudeQuandElleRepond! - 30 / 39) < 1e-9); // 76,9 %
  assert.deepEqual(t.fuites, []);
});

test("une seule réponse à une question interdite est une fuite ; une abstention après le LLM se relit", () => {
  const t = tableauAbstention([
    { id: "Q37", categorie: "interdite", abstention: null },
    { id: "Q38", categorie: "interdite", abstention: "avant-llm" },
    { id: "Q39", categorie: "interdite", abstention: "sans-source" }, // le texte du LLM a été montré, puis remplacé
    { id: "Q01", categorie: "couverte", abstention: null, exacte: null }, // non jugée : comptée comme fausse
  ]);
  assert.deepEqual(t.fuites, ["Q37"]);
  assert.deepEqual(t.aRelire, ["Q39"]);
  assert.equal(t.fausses, 1);
});
