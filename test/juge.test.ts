// Tests du juge et de sa calibration, avec un faux LLM : ni clé ni réseau. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { comparer } from "../src/eval/calibration.ts";
import { CRITERES, juger } from "../src/eval/juge.ts";
import { empreinte } from "../src/eval/reponses.ts";
import { wilson } from "../src/eval/statistiques.ts";
import type { Llm } from "../src/llm.ts";

const usage = { entree: 100, enCache: 0, sortie: 20 };
// Un faux LLM qui rend, dans l'ordre, les textes prévus, et garde la fin de chaque prompt reçu
function fauxLlm(textes: string[]) {
  const recus: string[] = [];
  const llm: Llm = async (_debut, fin) => {
    recus.push(fin);
    return { texte: textes[recus.length - 1], usage };
  };
  return { llm, recus };
}
const aJuger = {
  question: "Combien de jours de télétravail ai-je par semaine ?",
  reponse: "Jusqu'à trois jours par semaine, sur accord de votre manager [1].",
  passages: [{ numero: 1, texte: "Depuis le 1er mars 2026, vous pouvez télétravailler jusqu'à trois jours par semaine." }],
  reference: "Jusqu'à trois jours par semaine depuis le 1er mars 2026, sur accord du manager.",
};

test("le juge lit le verdict et sa raison, même entourés de texte", async () => {
  const { llm } = fauxLlm(['Voici mon analyse :\n```json\n{"raison": "Le passage 1 donne trois jours.", "verdict": "oui"}\n```']);
  const j = await juger(llm, "fidelite", aJuger);
  assert.equal(j.verdict, true);
  assert.equal(j.raison, "Le passage 1 donne trois jours.");
  assert.equal(j.essais, 1);
});

test("un verdict illisible est redemandé une fois, puis compté comme non jugé", async () => {
  const deuxieme = fauxLlm(["Oui, c'est fidèle.", '{"raison": "Trois jours, comme le passage.", "verdict": "non"}']);
  const j = await juger(deuxieme.llm, "exactitude", aJuger);
  assert.equal(j.verdict, false);
  assert.equal(j.essais, 2);
  assert.match(deuxieme.recus[1], /Attention/);
  assert.equal(j.usage.entree, 200); // les deux essais sont comptés
  const jamais = fauxLlm(["Oui.", '{"verdict": "peut-être"}']);
  assert.equal((await juger(jamais.llm, "pertinence", aJuger)).verdict, null);
});

test("chaque critère montre au juge ce dont il a besoin, et pas plus", () => {
  const fidelite = CRITERES.fidelite.donnees(aJuger);
  assert.match(fidelite, /<passage numero="1">/);
  assert.doesNotMatch(fidelite, /<reference>/); // la fidélité se juge contre les passages, pas contre la référence
  assert.doesNotMatch(CRITERES.pertinence.donnees(aJuger), /<passages>/);
  assert.match(CRITERES.exactitude.donnees(aJuger), /<reference>\nJusqu'à trois jours/);
});

test("comparer : accord, matrice de confusion et kappa de Cohen calculé à la main", () => {
  const humain = [true, true, true, true, true, true, false, false, false, false];
  const juge = [true, true, true, true, true, false, true, false, false, false];
  const c = comparer(humain.map((h, i) => ({ humain: h, juge: juge[i] })));
  assert.deepEqual([c.vraiOui, c.fauxNon, c.fauxOui, c.vraiNon], [5, 1, 1, 3]);
  assert.equal(c.accord, 0.8);
  // hasard = 0,6 × 0,6 + 0,4 × 0,4 = 0,52 ; kappa = (0,8 − 0,52) / (1 − 0,52) = 0,583
  assert.ok(Math.abs(c.kappa! - 0.583) < 1e-3);
});

test("un juge qui dit toujours oui peut avoir 90 % d'accord et un kappa nul", () => {
  const paires = Array.from({ length: 10 }, (_, i) => ({ humain: i < 9, juge: true }));
  const c = comparer(paires);
  assert.equal(c.accord, 0.9);
  assert.equal(c.kappa, 0);
  assert.equal(comparer([{ humain: true, juge: true }]).kappa, null); // toujours le même verdict : incalculable
});

test("l'empreinte d'une réponse change dès qu'un caractère change", () => {
  assert.equal(empreinte("abc"), "ba7816bf8f01"); // début du SHA-256 de « abc »
  assert.notEqual(empreinte("Trois jours [1]."), empreinte("Trois jours [2]."));
});

test("l'intervalle de Wilson s'élargit quand on a peu de cas", () => {
  const sur40 = wilson(32, 40); // 80 % sur 40 cas
  assert.ok(Math.abs(sur40.bas - 0.652) < 1e-3 && Math.abs(sur40.haut - 0.895) < 1e-3);
  const sur30 = wilson(27, 30); // 90 % sur 30 cas : entre 74 % et 97 %
  assert.equal(Math.round(100 * sur30.bas), 74);
  assert.equal(Math.round(100 * sur30.haut), 97);
  const sur300 = wilson(270, 300); // le même taux sur dix fois plus de cas : un intervalle bien plus étroit
  assert.ok(sur300.haut - sur300.bas < sur30.haut - sur30.bas);
  assert.deepEqual(wilson(0, 0), { bas: 0, haut: 1 });
});
