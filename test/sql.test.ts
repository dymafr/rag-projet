// Tests du text-to-SQL sécurisé (chapitre 12, leçon 3) : la validation par l'arbre de PostgreSQL, et l'accès en lecture
// (rôle, sécurité par ligne, set_config retiré) sur une vraie base PostgreSQL, PGlite, chargée avec les salariés fictifs.
// Le LLM est remplacé par un faux qui rend des requêtes écrites d'avance. Pas de Docker. Lancement : npm test
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { interrogerSoldes } from "../src/agent/soldes-sql.ts";
import type { Llm } from "../src/llm.ts";
import { executerEnLecture, perimetre, SCHEMA_ACCES } from "../src/sql/acces.ts";
import { enTexte, extraireSql, interroger } from "../src/sql/texte-vers-sql.ts";
import { validerSql } from "../src/sql/valider.ts";

let base: PGlite;
// PGlite n'a pas de pool : une connexion unique, que l'on « emprunte ». Sa méthode query passe, comme queryMode
// extended, par une instruction préparée : une seule instruction à la fois
const pool = {
  query: (sql: string, valeurs?: unknown[]) => base.query(sql, valeurs) as Promise<{ rows: never[] }>,
  connect: async () => ({
    query: (requete: string | { text: string; values?: unknown[] }, valeurs?: unknown[]) =>
      typeof requete === "string" ? base.query<Record<string, unknown>>(requete, valeurs) : base.query<Record<string, unknown>>(requete.text, requete.values),
    release: () => {},
  }),
};
before(async () => {
  base = await PGlite.create();
  await base.exec(await readFile("corpus/soldes/soldes.sql", "utf8"));
  await base.exec(SCHEMA_ACCES);
});
after(() => base.close());

const accepte = async (sql: string) => assert.deepEqual(await validerSql(sql), { ok: true }, sql);
const refuse = async (sql: string, motif: RegExp) => {
  const v = await validerSql(sql);
  assert.equal(v.ok, false, sql);
  if (!v.ok) assert.match(v.raison, motif, sql);
};

test("validerSql accepte un SELECT sur la vue : agrégat, regroupement, sous-requête nommée, commentaire", async () => {
  await accepte("SELECT count(*) FROM soldes_visibles WHERE cp_reliquat > 20;");
  await accepte("SELECT service, round(avg(rtt_restants), 1) AS m FROM soldes_visibles GROUP BY service ORDER BY m DESC LIMIT 3");
  await accepte("WITH nantes AS (SELECT * FROM soldes_visibles WHERE site = 'nantes') SELECT count(*) FROM nantes WHERE forfait_jours");
  await accepte("WITH a AS (SELECT * FROM soldes_visibles), b AS (SELECT * FROM a WHERE cp_reliquat > 20) SELECT count(*) FROM b");
  await accepte("SELECT prenom, nom FROM soldes_visibles WHERE nom ILIKE 'guerin' AND coalesce(rtt_restants, 0) > 0");
  // L'analyseur sait que la suite du commentaire n'est pas une instruction
  await accepte("SELECT count(*) FROM soldes_visibles -- ; DROP TABLE soldes");
});

test("validerSql refuse plusieurs instructions, une modification, même cachée dans un WITH, et SELECT INTO", async () => {
  await refuse("SELECT 1; DROP TABLE soldes", /une seule instruction/);
  await refuse("UPDATE soldes SET cp_reliquat = 99", /seul SELECT/);
  await refuse("WITH t AS (DELETE FROM soldes RETURNING *) SELECT count(*) FROM t", /modification interdite \(DeleteStmt\)/);
  await refuse("SELECT * INTO copie FROM soldes_visibles", /SELECT INTO/);
  await refuse("SELECT * FROM soldes_visibles FOR UPDATE", /verrou/);
  await refuse("SELEC count(*) FROM soldes_visibles", /erreur de syntaxe/);
});

test("validerSql refuse les autres tables, même sous le nom d'une sous-requête, et les fonctions qui ne calculent pas", async () => {
  await refuse("SELECT * FROM soldes", /seule la vue soldes_visibles/);
  await refuse("SELECT s.* FROM soldes_visibles v JOIN salaries s USING (matricule)", /reçu : salaries/);
  await refuse("SELECT rolname FROM pg_catalog.pg_roles", /pg_catalog.pg_roles/);
  // Une sous-requête ne se voit pas elle-même : le salaries intérieur est la vraie table (sonde du 17 octobre)
  await refuse("WITH salaries AS (SELECT * FROM salaries) SELECT count(*) FROM salaries", /reçu : salaries/);
  await refuse("SELECT count(*) FROM (WITH soldes AS (SELECT * FROM soldes) SELECT * FROM soldes) t", /reçu : soldes/);
  await refuse("SELECT set_config('rhea.matricule', 'K0006', true), count(*) FROM soldes_visibles", /set_config/);
  await refuse("SELECT current_setting('rhea.matricule')", /current_setting/);
  await refuse("SELECT pg_sleep(10)", /pg_sleep/);
});

test("la sécurité par ligne : un salarié voit sa ligne, un manager son équipe, le service RH tout le monde", async () => {
  const lignes = async (m: string) => Number((await executerEnLecture(pool, "SELECT count(*) AS n FROM soldes_visibles", m)).lignes[0].n);
  assert.equal(await lignes("K0042"), 1);
  assert.equal(await lignes("K0035"), 10); // elle et ses 9 équipiers
  assert.equal(await lignes("K0006"), 180);
  assert.equal(await lignes("K9999"), 0); // un matricule inconnu ne voit rien
  // Même sans la vue, les tables brutes ne montrent pas plus
  assert.equal(Number((await executerEnLecture(pool, "SELECT count(*) AS n FROM soldes", "K0042")).lignes[0].n), 1);
  assert.equal(Number((await executerEnLecture(pool, "SELECT count(*) AS n FROM salaries", "K0042")).lignes[0].n), 1);
  assert.equal(Number((await executerEnLecture(pool, "SELECT count(*) AS n FROM salaries", "K0035")).lignes[0].n), 10);
  assert.match(await perimetre(pool, "K0042"), /ne voit que ses propres soldes/);
  assert.match(await perimetre(pool, "K0035"), /son équipe \(9 personnes\)/);
  assert.match(await perimetre(pool, "K0006"), /service RH/);
});

test("la base tient seule : set_config retiré, écriture et instructions multiples refusées", async () => {
  // La sonde du 17 octobre : avant le REVOKE, cette requête faisait voir 180 lignes à K0042
  await assert.rejects(executerEnLecture(pool, "SELECT set_config('rhea.matricule', 'K0006', true)", "K0042"), /permission denied for function set_config/);
  await assert.rejects(executerEnLecture(pool, "UPDATE soldes SET cp_reliquat = 99", "K0006"), /read-only transaction/);
  await assert.rejects(executerEnLecture(pool, "SELECT 1; SELECT 2", "K0006"), /multiple commands|plusieurs/i);
});

// Un faux LLM : il rend, dans l'ordre, les réponses écrites d'avance, et garde les prompts reçus
function fauxLlm(reponses: string[]): Llm & { recus: string[] } {
  const recus: string[] = [];
  const llm = async (_debut: string, fin: string) => {
    recus.push(fin);
    return { texte: reponses[recus.length - 1] ?? "", usage: { entree: 10, enCache: 0, sortie: 5 } };
  };
  return Object.assign(llm, { recus });
}

test("interroger répare une requête refusée : la raison du refus part au LLM, qui corrige", async () => {
  const llm = fauxLlm(["```sql\nSELECT count(*) FROM soldes WHERE cp_reliquat > 20\n```", "```sql\nSELECT count(*) AS n FROM soldes_visibles WHERE cp_reliquat > 20\n```"]);
  const r = await interroger(llm, pool, "Combien de salariés ont plus de 20 jours de reliquat ?", "K0006");
  assert.equal(r.essais, 2);
  assert.equal(r.erreur, null);
  assert.equal(Number(r.resultat?.lignes[0].n), 11);
  assert.match(llm.recus[1], /Elle a été refusée : validation : seule la vue soldes_visibles/);
  // Deux refus : pas de troisième essai, l'erreur est rendue
  const echec = await interroger(fauxLlm(["SELECT pg_sleep(1)", "DROP TABLE soldes"]), pool, "?", "K0006");
  assert.equal(echec.resultat, null);
  assert.match(echec.erreur ?? "", /validation : seul SELECT/);
});

test("interroger_soldes donne le périmètre avec le résultat, et ne fait rien sans salarié connecté", async () => {
  const outil = interrogerSoldes(pool, fauxLlm(["```sql\nSELECT count(*) AS salaries FROM soldes_visibles WHERE cp_reliquat > 20\n```"]));
  const { texte } = await outil.executer({ question: "Combien de salariés ont plus de 20 jours de reliquat ?" }, { date: "2026-10-17", matricule: "K0042", profil: "salarie" });
  assert.match(texte, /Périmètre : le salarié connecté ne voit que ses propres soldes/);
  assert.match(texte, /salaries : 0/); // K0042 a 16 jours : le chiffre ne porte que sur sa ligne, d'où le périmètre
  const anonyme = await outil.executer({ question: "Combien de salariés ?" }, { date: "2026-10-17", profil: "salarie" });
  assert.match(anonyme.texte, /Aucun salarié n'est connecté/);
});

test("extraireSql lit le bloc sql, et enTexte présente une ligne en colonnes, plusieurs en tableau", () => {
  assert.equal(extraireSql("Voici :\n```sql\nSELECT 1;\n```\nFin."), "SELECT 1;");
  assert.equal(extraireSql("SELECT 2"), "SELECT 2");
  assert.equal(enTexte({ colonnes: ["n"], lignes: [{ n: 11 }], tronque: false }), "n : 11");
  assert.equal(enTexte({ colonnes: ["a", "b"], lignes: [{ a: 1, b: null }, { a: 2, b: "x" }], tronque: false }), "a | b\n1 | NULL\n2 | x");
  assert.equal(enTexte({ colonnes: [], lignes: [], tronque: false }), "Aucune ligne.");
});
