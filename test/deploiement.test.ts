// Tests du déploiement (chapitre 14, leçon 10) : un secret se lit dans un fichier (NOM_FILE), et le compose de production
// garde ses garde-fous (pas d'inspection, pas de port de la base, conteneurs sans droits, ordre de démarrage, versions
// figées). Une régression ici ne se verrait qu'en production : on la voit au premier npm test. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";

test("un secret se lit dans le fichier que donne NOM_FILE, sans écraser une valeur déjà posée", async () => {
  const dossier = await mkdtemp(join(tmpdir(), "rhea-secrets-"));
  try {
    await writeFile(join(dossier, "cle"), "sk-ant-api03-factice\n");
    const lire = (env: Record<string, string>) =>
      execFileSync(process.execPath, ["-e", 'import("./src/config.ts").then(() => console.log(process.env.ANTHROPIC_API_KEY ?? ""))'], {
        env: { PATH: process.env.PATH ?? "", LLM_PROVIDER: "ollama", LLM_MODEL: "m", EMBEDDING_MODEL: "e", DATABASE_URL: "postgres://x@y/z", ...env },
        encoding: "utf8",
      }).trim();
    assert.equal(lire({ ANTHROPIC_API_KEY_FILE: join(dossier, "cle") }), "sk-ant-api03-factice"); // sans le saut de ligne final
    assert.equal(lire({ ANTHROPIC_API_KEY_FILE: join(dossier, "cle"), ANTHROPIC_API_KEY: "deja-la" }), "deja-la");
  } finally {
    await rm(dossier, { recursive: true, force: true });
  }
});

type Service = Record<string, any>;
const compose = parse(await readFile("compose.production.yaml", "utf8"), { merge: true }) as { services: Record<string, Service>; secrets: Record<string, unknown> };

test("le compose de production : pas d'inspection, la base sans port publié, l'API sur cette machine seulement", () => {
  const { api, db } = compose.services;
  assert.equal(api.environment.INSPECTION, "non");
  assert.equal(db.ports, undefined);
  assert.deepEqual(api.ports, ["127.0.0.1:3000:3000"]);
  assert.ok(api.healthcheck.test.join(" ").includes("/sante"));
});

test("le compose de production : chaque service de Rhéa sans droits, en lecture seule, ses secrets en fichiers", () => {
  for (const nom of ["migrations", "ingestion", "api", "travailleur"]) {
    const s = compose.services[nom];
    assert.equal(s.user, "node", nom);
    assert.equal(s.read_only, true, nom);
    assert.deepEqual(s.cap_drop, ["ALL"], nom);
    assert.equal(s.init, true, nom);
    // Aucune clé en clair dans la configuration : seulement des chemins vers /run/secrets
    for (const [cle, valeur] of Object.entries(s.environment ?? {})) {
      if (/API_KEY|PASSWORD/.test(cle)) assert.ok(cle.endsWith("_FILE") && String(valeur).startsWith("/run/secrets/"), `${nom} ${cle}`);
    }
  }
  assert.deepEqual(Object.keys(compose.secrets).sort(), ["anthropic_api_key", "mot_de_passe_base", "openai_api_key", "voyage_api_key"]);
});

test("le compose de production : le registre des effacements (chapitre 13) est celui du dépôt, relu et écrit en place", () => {
  // Hors de l'image, un document effacé mais encore présent à la source reviendrait dans l'index à la prochaine ingestion
  for (const nom of ["ingestion", "travailleur"]) assert.ok(compose.services[nom].volumes.includes("./effacements.json:/app/effacements.json"), nom);
});

test("le compose de production : l'ordre de démarrage, base saine, puis migrations, puis ingestion, puis l'API", () => {
  const { migrations, ingestion, api, travailleur } = compose.services;
  assert.deepEqual(migrations.depends_on, { db: { condition: "service_healthy" } });
  assert.deepEqual(ingestion.depends_on, { migrations: { condition: "service_completed_successfully" } });
  assert.deepEqual(api.depends_on, { ingestion: { condition: "service_completed_successfully" } });
  assert.deepEqual(travailleur.depends_on, api.depends_on);
});

test("des images aux versions figées, et une image de Rhéa qui tourne sans droits", async () => {
  assert.match(compose.services.db.image, /^pgvector\/pgvector:\d+\.\d+\.\d+-pg18/);
  const dockerfile = await readFile("Dockerfile", "utf8");
  assert.ok([...dockerfile.matchAll(/^FROM (\S+)/gm)].every(([, image]) => /:\d+\.\d+\.\d+/.test(image)));
  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /npm ci --omit=dev/);
  const ignore = await readFile(".dockerignore", "utf8");
  for (const secret of [".env", "secrets/", "donnees/", "journal/"]) assert.ok(ignore.split("\n").includes(secret), secret);
});
