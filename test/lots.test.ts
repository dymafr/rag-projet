// Tests du traitement par lots et des reprises. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { avecReprises, parLots } from "../src/embeddings/lots.ts";

// Une erreur qui porte un statut HTTP, comme celles des SDK
const erreurHttp = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

test("parLots découpe en lots et garde l'ordre", async () => {
  const tailles: number[] = [];
  const resultats = await parLots(Array.from({ length: 70 }, (_, i) => i), 32, async (lot) => {
    tailles.push(lot.length);
    return lot.map((x) => x * 10);
  });
  assert.deepEqual(tailles, [32, 32, 6]);
  assert.equal(resultats.length, 70);
  assert.equal(resultats[69], 690);
});

test("avecReprises relance après une limite de débit (429)", async () => {
  let appels = 0;
  const resultat = await avecReprises(async () => {
    appels++;
    if (appels < 3) throw erreurHttp(429);
    return "ok";
  }, 4, 1);
  assert.equal(resultat, "ok");
  assert.equal(appels, 3);
});

test("avecReprises ne relance pas une requête invalide (400)", async () => {
  let appels = 0;
  await assert.rejects(
    avecReprises(async () => {
      appels++;
      throw erreurHttp(400);
    }, 4, 1),
    /HTTP 400/,
  );
  assert.equal(appels, 1);
});

test("avecReprises abandonne après le dernier essai", async () => {
  let appels = 0;
  await assert.rejects(
    avecReprises(async () => {
      appels++;
      throw erreurHttp(503);
    }, 3, 1),
    /HTTP 503/,
  );
  assert.equal(appels, 3);
});
