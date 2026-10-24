// Tests de la file d'attente des tâches lentes (chapitre 14, leçon 1), dans une vraie base (PGlite) : l'ordre, les
// nouveaux essais espacés, l'échec définitif, et la récupération d'une tâche abandonnée. Lancement : npm test
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { ajouter, attenteAvantEssai, creerFile, echouer, etatDeLaFile, prendre, recuperer, terminer } from "../src/taches/file.ts";

async function fileDeTest(t: TestContext) {
  const base = await PGlite.create();
  t.after(() => base.close());
  await creerFile(base);
  await creerFile(base); // sans danger une seconde fois
  return base;
}

test("une tâche se prend une seule fois, dans l'ordre d'arrivée, puis se termine", async (t) => {
  const base = await fileDeTest(t);
  const premiere = await ajouter(base, "reindexer");
  const seconde = await ajouter(base, "effacer", { document: "TK-2026-0066" });
  const a = await prendre(base);
  const b = await prendre(base);
  assert.deepEqual([a?.id, b?.id], [premiere, seconde]);
  assert.deepEqual([a?.etat, a?.essais], ["en_cours", 1]);
  assert.deepEqual(b?.donnees, { document: "TK-2026-0066" });
  assert.equal(await prendre(base), null); // plus rien à prendre
  await terminer(base, premiere);
  const { comptes } = await etatDeLaFile(base);
  assert.deepEqual(comptes, { faite: 1, en_cours: 1 });
});

test("une tâche en échec revient plus tard, avec une attente qui double, puis échoue pour de bon", async (t) => {
  const base = await fileDeTest(t);
  const id = await ajouter(base, "reindexer", {}, 2);
  const essai1 = (await prendre(base))!;
  await echouer(base, essai1, "base injoignable");
  assert.equal(await prendre(base), null); // pas avant 30 s
  const { rows } = await base.query<{ attente: number; erreur: string }>("SELECT extract(epoch FROM disponible_le - now())::int AS attente, erreur FROM taches WHERE id = $1", [id]);
  assert.ok(rows[0].attente > 25 && rows[0].attente <= 30);
  assert.equal(rows[0].erreur, "base injoignable");
  await base.query("UPDATE taches SET disponible_le = now() WHERE id = $1", [id]); // le temps passe
  const essai2 = (await prendre(base))!;
  assert.equal(essai2.essais, 2);
  await echouer(base, essai2, "toujours injoignable");
  const { dernieres } = await etatDeLaFile(base);
  assert.deepEqual([dernieres[0].etat, dernieres[0].erreur], ["echouee", "toujours injoignable"]);
  assert.deepEqual([1, 2, 3, 4, 10].map(attenteAvantEssai), [30, 60, 120, 240, 3600]);
});

test("une tâche abandonnée en cours par un travailleur arrêté revient en attente, puis échoue après son dernier essai", async (t) => {
  const base = await fileDeTest(t);
  const id = await ajouter(base, "reindexer");
  await prendre(base);
  assert.equal(await recuperer(base), 0); // trop récente
  await base.query("UPDATE taches SET commence_le = now() - interval '2 hours' WHERE id = $1", [id]);
  assert.equal(await recuperer(base), 1);
  assert.equal((await prendre(base))?.essais, 2);
  // Abandonnée à chaque essai : au dernier, elle échoue pour de bon au lieu de revenir sans fin
  await base.query("UPDATE taches SET essais = max_essais, commence_le = now() - interval '2 hours' WHERE id = $1", [id]);
  assert.equal(await recuperer(base), 1);
  const { dernieres } = await etatDeLaFile(base);
  assert.deepEqual([dernieres[0].etat, dernieres[0].erreur], ["echouee", "abandonnée en cours, à chaque essai"]);
  assert.equal(await prendre(base), null);
});
