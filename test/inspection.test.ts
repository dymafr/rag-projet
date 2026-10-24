// Les documents de l'inspection, lus dans PostgreSQL avec les droits du profil : leur format sert directement à l'interface.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import type pg from "pg";
import type { Document } from "../src/ingestion/document.ts";
import { SCHEMA_DROITS } from "../src/recherche/droits.ts";
import { insererParLots, ligne } from "../src/stockage/chunks.ts";
import { creerTable } from "../src/stockage/schema.ts";
import { nomsDesSites } from "../web/src/outils/format.ts";

Object.assign(process.env, {
  LLM_PROVIDER: "ollama", LLM_MODEL: "factice", EMBEDDING_PROVIDER: "transformers", EMBEDDING_MODEL: "factice",
  DATABASE_URL: "postgres://factice@localhost/factice",
});
const { inspectionDe, lecteurDExecutions } = await import("../src/api/inspection.ts");

test("l'index rend les sites comme une liste, avec plusieurs passages, un seul site ou aucun, sous les droits du profil", async () => {
  const base = await PGlite.create({ extensions: { vector } });
  try {
    await base.exec("CREATE EXTENSION vector");
    await creerTable(base, 2);
    const documents: { id: string; sites: Document["metadonnees"]["site"]; acces: "tous" | "manager"; passages: number }[] = [
      { id: "POL-DEUX", sites: ["nantes", "lyon"], acces: "tous", passages: 2 },
      { id: "POL-UN", sites: ["lyon"], acces: "tous", passages: 1 },
      { id: "POL-TOUS", sites: [], acces: "tous", passages: 1 },
      { id: "MGR-PRIVE", sites: ["lyon"], acces: "manager", passages: 1 },
    ];
    for (const { id, sites, acces, passages } of documents) {
      const document: Document = {
        id, source: `${id}.md`, titre: id, texte: "Une règle.",
        metadonnees: { id, titre: id, type: "politique", date_effet: "2026-01-01", acces, langue: "fr", site: sites },
      };
      await insererParLots(base, Array.from({ length: passages }, (_, i) =>
        ligne({ id: `${id}#${i + 1}`, document: id, titres: [id], texte: "Une règle.", taille: 3 }, document, [1, 0], null),
      ));
    }
    await base.exec(SCHEMA_DROITS);
    const query = (sql: string, valeurs?: unknown[]) => base.query(sql, valeurs);
    const pool = { query, connect: async () => ({ query, release: () => {} }) } as unknown as pg.Pool;
    const inspection = inspectionDe(pool, { version: "test" });
    const index = await inspection.documents("salarie");
    assert.deepEqual(index.map((d) => d.document), ["POL-DEUX", "POL-TOUS", "POL-UN"]);
    assert.deepEqual(index.map((d) => d.sites), [["nantes", "lyon"], [], ["lyon"]]);
    assert.deepEqual(index.map((d) => nomsDesSites(d.sites)), ["Nantes, Lyon", "tous", "Lyon"]);
    assert.equal(index[0].passages, 2);
    assert.equal(index[0].tokens, 6);
    assert.equal(index[0].date_effet, "2026-01-01");
    assert.equal((await inspection.documents("manager"))[0].document, "MGR-PRIVE");
  } finally {
    await base.close();
  }
});

test("la liste des évaluations garde les scores sans proposer les exécutions qui ne peuvent pas être comparées", async () => {
  const dossier = await mkdtemp(join(tmpdir(), "rhea-evaluations-"));
  try {
    for (const [nom, jeu, fichier] of [
      ["complete", "travail", true],
      ["resume-seul", "travail", false],
      ["cachee", "cache", true],
    ] as const) {
      const chemin = join(dossier, nom);
      const resume = { nom, jeu, date: "2026-10-20" };
      await mkdir(chemin);
      await writeFile(join(chemin, "resume.json"), JSON.stringify(resume));
      if (fichier) await writeFile(join(chemin, "execution.json"), JSON.stringify({ ...resume, resultats: [] }));
    }
    const lecteur = lecteurDExecutions(dossier);
    assert.deepEqual((await lecteur.resumes()).map((r) => [r.nom, r.detailsDisponibles]), [
      ["cachee", false], ["complete", true], ["resume-seul", false],
    ]);
    assert.equal(await lecteur.lire("resume-seul"), null);
    const inspection = inspectionDe({} as pg.Pool, { version: "test", resultats: dossier });
    assert.equal(await inspection.evaluation("cachee"), "cache");
  } finally {
    await rm(dossier, { recursive: true, force: true });
  }
});
