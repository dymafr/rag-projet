// Tests de la recherche sur une vraie base PostgreSQL avec pgvector, PGlite, qui tourne dans le processus de test :
// pas de Docker. Les vecteurs viennent de test/exemples/recherche.json (npm run enregistrer). Lancement : npm test
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import type { Chunk } from "../src/decoupage/chunk.ts";
import type { Document } from "../src/ingestion/document.ts";
import { chercher } from "../src/recherche/vectorielle.ts";
import { empreintes, insererParLots, ligne, metadonnees } from "../src/stockage/chunks.ts";
import { mettreAJour, planifier, supprimer, type Empreintes } from "../src/stockage/incremental.ts";
import { basculer, creerIndex, creerTable, ecrireIndexation, lireIndexation } from "../src/stockage/schema.ts";

type Exemple = { chunk: Chunk; document: Document; dateFin: string | null; vecteur: number[] };
const exemples: { questions: Record<string, number[]>; chunks: Exemple[] } = JSON.parse(await readFile("test/exemples/recherche.json", "utf8"));
const question = (texte: string) => exemples.questions[texte];
const TELETRAVAIL = "Combien de jours de télétravail par semaine ?";
const REPAS = "Quel est le plafond pour un repas avec un client à Lyon ?";
const ids = (resultats: { id: string }[]) => resultats.map((resultat) => resultat.id);

// Une base neuve en mémoire, avec l'extension vector
async function nouvelleBase() {
  const base = await PGlite.create({ extensions: { vector } });
  await base.exec("CREATE EXTENSION IF NOT EXISTS vector");
  return base;
}

let base: PGlite;

// La base de ce fichier de tests, avec la même table et le même index que dans Docker
before(async () => {
  base = await nouvelleBase();
  await creerTable(base, exemples.chunks[0].vecteur.length);
  await insererParLots(base, exemples.chunks.map((e) => ligne(e.chunk, e.document, e.vecteur, e.dateFin)));
  await creerIndex(base);
});

after(async () => {
  await base.close();
});

test("les chunks les plus proches arrivent du plus proche au moins proche", async () => {
  const resultats = await chercher(base, question(TELETRAVAIL), 3);
  // des passages sur le nombre de jours de télétravail : la FAQ, le guide, l'article 4 de l'accord ou de l'avenant.
  // Leurs scores sont proches : on ne fige pas leur ordre exact, qui peut changer d'un enregistrement à l'autre
  const attendus = ["FAQ-RH#2", "POL-TTG-01#3", "POL-TT-01#8", "POL-TT-02#10"];
  assert.equal(resultats.length, 3);
  assert.ok(resultats.every((resultat) => attendus.includes(resultat.id)), ids(resultats).join(", "));
  assert.ok(resultats[0].score >= resultats[1].score && resultats[1].score >= resultats[2].score);
});

test("en octobre 2026, l'accord de 2023, remplacé par l'avenant, ne sort plus", async () => {
  const resultats = await chercher(base, question(TELETRAVAIL), 5, { enVigueurLe: "2026-10-01" });
  assert.ok(ids(resultats).includes("POL-TT-02#10"));
  assert.ok(!ids(resultats).includes("POL-TT-01#8"));
});

test("en janvier 2026, c'est l'accord de 2023 qui s'appliquait", async () => {
  const resultats = await chercher(base, question(TELETRAVAIL), 3, { enVigueurLe: "2026-01-15" });
  assert.equal(resultats[0].id, "POL-TT-01#8");
  assert.ok(!ids(resultats).includes("POL-TT-02#10"));
});

test("le jour même où l'avenant entre en vigueur, c'est lui qui s'applique, et non plus l'accord de 2023", async () => {
  const resultats = await chercher(base, question(TELETRAVAIL), 5, { types: ["accord"], enVigueurLe: "2026-03-01" });
  assert.ok(ids(resultats).includes("POL-TT-02#10"));
  assert.ok(!ids(resultats).includes("POL-TT-01#8"));
});

test("les filtres de type et de site s'appliquent avant de garder les k meilleurs", async () => {
  assert.deepEqual(ids(await chercher(base, question(REPAS), 3, { types: ["faq"] })), ["FAQ-RH#19", "FAQ-RH#20", "FAQ-RH#21"]);
  // trois tickets de Lyon et un de Nantes : à Nantes, il ne reste que le ticket nantais
  assert.deepEqual(ids(await chercher(base, question(REPAS), 10, { types: ["ticket"], sites: ["nantes"] })), ["TK-2026-0027#1"]);
  assert.equal((await chercher(base, question(REPAS), 10, { types: ["ticket"], sites: ["lyon"] })).length, 3);
});

test("index forcé et filtre sélectif : sans parcours itératif, il manque des résultats", async () => {
  await base.query("SET enable_seqscan = off"); // passer par l'index, comme sur une grande table
  await base.query("SET hnsw.ef_search = 4"); // l'index ne propose que 4 candidats
  try {
    await base.query("SET hnsw.iterative_scan = off");
    const sans = await chercher(base, question(REPAS), 3, { langue: "en" });
    await base.query("SET hnsw.iterative_scan = strict_order");
    const avec = await chercher(base, question(REPAS), 3, { langue: "en" });
    assert.ok(sans.length < 2, `sans parcours itératif : ${sans.length} résultats`);
    assert.deepEqual(new Set(ids(avec)), new Set(["GRP-TRV-01#16", "GRP-TRV-01#2"])); // les deux seuls chunks en anglais
  } finally {
    await base.query("RESET enable_seqscan");
    await base.query("RESET hnsw.ef_search");
    await base.query("RESET hnsw.iterative_scan");
  }
});

test("reconstruction : la nouvelle table remplace l'ancienne, avec ses index, et accepte un upsert", async () => {
  const autre = await nouvelleBase(); // une base à part : celle des autres tests ne change pas
  try {
    await creerTable(autre, 768);
    await creerTable(autre, 2, "vector", "chunks_nouveau");
    await creerIndex(autre, "vector", "chunks_nouveau");
    await basculer(autre);
    await ecrireIndexation(autre, { modele: "un autre modèle", dimension: 2, stockage: "vector" });

    const { rows: index } = await autre.query<{ indexname: string }>("SELECT indexname FROM pg_indexes WHERE tablename = 'chunks' ORDER BY indexname");
    assert.deepEqual(index.map((ligne) => ligne.indexname), ["chunks_embedding_idx", "chunks_pkey"]);
    assert.deepEqual(await lireIndexation(autre), { modele: "un autre modèle", dimension: 2, stockage: "vector" });

    const { chunk, document } = exemples.chunks[0];
    await insererParLots(autre, [ligne(chunk, document, [1, 0], null)]);
    await insererParLots(autre, [ligne(chunk, document, [0, 1], null)]); // même id : la ligne est remplacée
    const { rows } = await autre.query<{ embedding: string }>("SELECT embedding::text FROM chunks");
    assert.deepEqual(rows, [{ embedding: "[0,1]" }]);
  } finally {
    await autre.close();
  }
});

// Ce test modifie la base de ce fichier : il reste le dernier
test("indexation incrémentale sur la base : mise à jour des métadonnées et suppression", async () => {
  const enBase = (await base.query<Empreintes>("SELECT id, empreinte, empreinte_meta FROM chunks")).rows;
  // L'avenant disparaît du corpus, et l'accord de 2023 redevient en vigueur : plus de date de fin
  const voulus = exemples.chunks
    .filter((e) => e.chunk.document !== "POL-TT-02")
    .map((e) => {
      const dateFin = e.chunk.document === "POL-TT-01" ? null : e.dateFin;
      return { ...e, id: e.chunk.id, dateFin, ...empreintes(e.chunk, e.document, dateFin) };
    });
  const plan = planifier(voulus, enBase);
  assert.deepEqual([plan.aVectoriser.length, ids(plan.aMettreAJour), plan.aSupprimer], [0, ["POL-TT-01#8"], ["POL-TT-02#10"]]);

  for (const v of plan.aMettreAJour) await mettreAJour(base, v.id, metadonnees(v.document, v.dateFin), v.empreinte_meta);
  await supprimer(base, plan.aSupprimer);
  const resultats = await chercher(base, question(TELETRAVAIL), 3, { types: ["accord"], enVigueurLe: "2026-10-01" });
  assert.deepEqual(ids(resultats), ["POL-TT-01#8"]);
});
