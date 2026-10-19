// Tests du contrôle d'accès documentaire (chapitre 13, leçon 1) : le profil lu dans l'annuaire, le filtre obligatoire,
// et la sécurité par ligne sur chunks, sur une vraie base PostgreSQL, PGlite. Trois passages, un par niveau d'accès,
// avec un vecteur factice ; puis le branchement des deux barrières dans trouverPassages (leçon 5). Pas de Docker.
// Lancement : npm test
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { vector } from "@electric-sql/pglite-pgvector";
import type { Chunk } from "../src/decoupage/chunk.ts";
import type { Document } from "../src/ingestion/document.ts";
import { basePour, NIVEAUX, profilDeSession, profilDuSalarie, SCHEMA_DROITS, type Connexions, type Profil } from "../src/recherche/droits.ts";
import { chercherPleinTexte } from "../src/recherche/plein-texte.ts";
import { chercher } from "../src/recherche/vectorielle.ts";
import { insererParLots, ligne } from "../src/stockage/chunks.ts";
import { ajouterPleinTexte, creerTable } from "../src/stockage/schema.ts";

const passage = (id: string, acces: Document["metadonnees"]["acces"], texte: string) => {
  const doc: Document = {
    id: id.split("#")[0],
    source: `${id}.md`,
    titre: id,
    texte: "",
    metadonnees: { id, titre: id, type: acces === "rh" ? "ticket" : "politique", date_effet: "2026-01-01", acces, langue: "fr", site: ["lyon"] },
  };
  const chunk: Chunk = { id, document: doc.id, titres: [id], texte, taille: texte.split(" ").length };
  return ligne(chunk, doc, [1, 0], null);
};

let base: PGlite;
// PGlite n'a pas de pool : une connexion unique, que l'on « emprunte », comme dans sql.test.ts
const pool = {
  query: (sql: string, valeurs?: unknown[]) => base.query(sql, valeurs) as Promise<{ rows: never[] }>,
  connect: async () => ({ query: (sql: string, valeurs?: unknown[]) => base.query(sql, valeurs) as Promise<{ rows: never[] }>, release: () => {} }),
};

before(async () => {
  base = await PGlite.create({ extensions: { vector, unaccent } });
  await base.exec("CREATE EXTENSION IF NOT EXISTS vector");
  await creerTable(base, 2);
  await insererParLots(base, [
    passage("POL-CP-01#1", "tous", "Les congés payés : 25 jours ouvrés par an."),
    passage("MGR-PR-01#1", "manager", "Le barème des primes annuelles. Document réservé aux managers."),
    passage("TK-2026-0001#1", "rh", "Ticket : demande sur les primes et les congés."),
  ]);
  await ajouterPleinTexte(base);
  // exec : PGlite n'accepte plusieurs instructions qu'ainsi (le pool de pg les accepte dans query, sans paramètre)
  await base.exec(SCHEMA_DROITS);
  await base.exec(SCHEMA_DROITS); // une seconde fois : rien ne change (npm run indexer le relance à chaque fois)
  // Un annuaire minimal : la table salaries du chapitre 10 a bien plus de colonnes
  await base.exec(`CREATE TABLE salaries (matricule text PRIMARY KEY, role text NOT NULL);
    INSERT INTO salaries VALUES ('K0101', 'salarie'), ('K0035', 'manager'), ('K0006', 'rh');`);
});
after(() => base.close());

const lignes = async (profil: Profil, sql = "SELECT id FROM chunks ORDER BY id") =>
  (await basePour(pool, profil).query<{ id: string }>(sql)).rows.map((r) => r.id);

test("le profil se lit dans l'annuaire ; sans matricule, le plus restreint ; un matricule inconnu est refusé", async () => {
  assert.equal(await profilDuSalarie(pool, "K0035"), "manager");
  assert.equal(await profilDuSalarie(pool, "K9999"), null);
  assert.equal(await profilDeSession(pool, undefined), "salarie");
  assert.equal(await profilDeSession(pool, "K0006"), "rh");
  await assert.rejects(profilDeSession(pool, "K9999"), /Aucun salarié n'a le matricule K9999 : recherche refusée/);
  // Chaque profil lit au moins ce que lit le précédent
  assert.ok(NIVEAUX.salarie.every((n) => NIVEAUX.manager.includes(n)) && NIVEAUX.manager.every((n) => NIVEAUX.rh.includes(n)));
});

test("la sécurité par ligne : chaque profil ne voit que ses niveaux, même dans une requête sans aucun filtre", async () => {
  assert.deepEqual(await lignes("salarie"), ["POL-CP-01#1"]);
  assert.deepEqual(await lignes("manager"), ["MGR-PR-01#1", "POL-CP-01#1"]);
  assert.deepEqual(await lignes("rh"), ["MGR-PR-01#1", "POL-CP-01#1", "TK-2026-0001#1"]);
  // Par identifiant non plus : un passage réservé ne se lit pas en le nommant
  assert.deepEqual(await lignes("salarie", "SELECT id FROM chunks WHERE id = 'MGR-PR-01#1'"), []);
});

test("sans niveaux posés, le rôle de recherche ne voit rien ; et rien ne reste sur la connexion rendue", async () => {
  await base.query("BEGIN");
  await base.query("SET LOCAL ROLE rhea_recherche");
  const { rows } = await base.query<{ n: number }>("SELECT count(*)::int AS n FROM chunks");
  await base.query("ROLLBACK");
  assert.equal(rows[0].n, 0); // un oubli ne montre rien, au lieu de tout montrer
  await lignes("rh");
  const apres = await base.query<{ qui: string; niveaux: string | null }>("SELECT current_user AS qui, current_setting('rhea.niveaux', true) AS niveaux");
  assert.notEqual(apres.rows[0].qui, "rhea_recherche");
  assert.ok(!apres.rows[0].niveaux); // vide ou absent : ni rôle ni niveaux ne survivent à la transaction
});

test("les deux barrières : un filtre trop large ne passe pas la base, et la base ne remplace pas le filtre", async () => {
  // Le filtre du profil rh sur la base d'un salarié : la sécurité par ligne garde le dernier mot
  const large = await chercher(basePour(pool, "salarie"), [1, 0], 10, { acces: NIVEAUX.rh });
  assert.deepEqual(large.map((r) => r.id), ["POL-CP-01#1"]);
  // Le filtre d'un salarié sur la base d'un manager : le filtre suffit à écarter le document des managers
  const etroit = await chercher(basePour(pool, "manager"), [1, 0], 10, { acces: NIVEAUX.salarie });
  assert.deepEqual(etroit.map((r) => r.id), ["POL-CP-01#1"]);
});

test("le plein texte aussi : un salarié ne trouve pas « primes », et ses statistiques ne comptent pas les passages réservés", async () => {
  const salarie = basePour(pool, "salarie");
  assert.deepEqual(await chercherPleinTexte(salarie, "primes", 5, { acces: NIVEAUX.salarie }), []);
  const rh = await chercherPleinTexte(basePour(pool, "rh"), "primes", 5, { acces: NIVEAUX.rh });
  assert.deepEqual(new Set(rh.map((r) => r.id)), new Set(["MGR-PR-01#1", "TK-2026-0001#1"]));
  // ts_stat relit la table sous la sécurité par ligne : les mots des passages réservés n'y figurent pas
  const mots = async (profil: Profil) => (await lignes(profil, "SELECT word AS id FROM ts_stat('SELECT tsv FROM chunks') ORDER BY word")).length;
  assert.ok((await mots("salarie")) < (await mots("rh")));
});

test("une vue lit la table avec les droits de son propriétaire, sauf en security_invoker (comme celle de LangChain)", async () => {
  await base.exec(`CREATE VIEW vue_proprietaire AS SELECT id FROM chunks;
    CREATE VIEW vue_invoker WITH (security_invoker = true) AS SELECT id FROM chunks;
    GRANT SELECT ON vue_proprietaire, vue_invoker TO rhea_recherche;`);
  assert.equal((await lignes("salarie", "SELECT id FROM vue_proprietaire")).length, 3); // la fuite : la vue passe outre
  assert.deepEqual(await lignes("salarie", "SELECT id FROM vue_invoker"), ["POL-CP-01#1"]);
  // La vraie vue du projet, celle de LangChain : frameworks/langchain.ts lit la configuration dès l'import (des valeurs
  // factices suffisent, ce fichier de test a son propre processus)
  Object.assign(process.env, { LLM_PROVIDER: "ollama", LLM_MODEL: "factice", EMBEDDING_PROVIDER: "transformers", EMBEDDING_MODEL: "factice" });
  process.env.DATABASE_URL = "postgres://factice@localhost/factice";
  const { VUE } = await import("../src/frameworks/langchain.ts");
  await base.exec(`${VUE};\n    GRANT SELECT ON chunks_langchain TO rhea_recherche;`);
  assert.deepEqual(await lignes("salarie", "SELECT id FROM chunks_langchain"), ["POL-CP-01#1"]);
});

// Chaque barrière a son test ci-dessus ; celui-ci vérifie qu'elles sont branchées sur le profil, là où la recherche les
// pose (passages.ts). Une connexion espionne note chaque requête et la connexion qui la reçoit, et ne rend aucune ligne
test("trouverPassages branche les deux barrières sur le profil : la base restreinte à ses niveaux, et le filtre", async () => {
  // passages.ts lit la configuration dès l'import : des valeurs factices suffisent (ce fichier de test a son propre
  // processus), ni LLM, ni modèle d'embedding, ni base ne sont appelés
  const factices = { LLM_PROVIDER: "ollama", LLM_MODEL: "factice", EMBEDDING_PROVIDER: "transformers", EMBEDDING_MODEL: "factice" };
  Object.assign(process.env, factices, { DATABASE_URL: "postgres://factice@localhost/factice" });
  const { trouverPassages } = await import("../src/recherche/passages.ts");
  const { RECHERCHE } = await import("../src/recherche/reglages.ts");
  const notees: { client: boolean; sql: string; parametres: unknown[] }[] = [];
  const espionne = (client: boolean) => ({
    query: async (sql: string, parametres: unknown[] = []) => {
      notees.push({ client, sql, parametres });
      return { rows: sql.includes("to_regclass") ? [{ nom: null }] : [] }; // pas de table indexation : rien à comparer
    },
  });
  const pool = { ...espionne(false), connect: async () => ({ ...espionne(true), release: () => {} }) } as unknown as Connexions;
  await trouverPassages(pool, "Quel est le barème des primes ?", 3, "salarie", "2026-10-13", { ...RECHERCHE, mode: "plein-texte", filtresExtraits: false }, {});
  const recherches = notees.filter((n) => /\bchunks\b/.test(n.sql));
  assert.ok(recherches.length > 0);
  for (const r of recherches) {
    assert.ok(r.client, "la recherche passe par basePour, pas directement par le pool");
    assert.ok(r.parametres.some((p) => JSON.stringify(p) === JSON.stringify(NIVEAUX.salarie)), "le filtre porte les niveaux du profil");
  }
  const niveaux = notees.filter((n) => n.sql.includes("set_config('rhea.niveaux'")).map((n) => n.parametres[0]);
  assert.ok(niveaux.length > 0 && niveaux.every((n) => n === "tous"), "la base est restreinte aux niveaux du profil");
});
