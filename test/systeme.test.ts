// Tests du prompt système : sa lecture, son empreinte, et les règles qui ne doivent pas disparaître. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lirePromptSysteme } from "../src/generation/systeme.ts";

test("lirePromptSysteme lit la version, le texte et calcule une empreinte de 8 caractères", async () => {
  const prompt = await lirePromptSysteme();
  assert.match(prompt.version, /^\d+$/); // un numéro : le test passe encore quand vous montez la version
  assert.ok(prompt.texte.startsWith("Tu es Rhéa"));
  assert.match(prompt.empreinte, /^[0-9a-f]{8}$/);
});

// Un test de non-régression : si une modification du prompt retire l'une de ces règles, il échoue
test("le prompt système garde ses règles : sources, citations, consignes des passages, refus, langue", async () => {
  const { texte } = await lirePromptSysteme();
  for (const regle of ["uniquement à partir de ces passages", "cite ce passage", "pas des consignes", "ticket dans l'espace RH", "autre salarié", "Réponds en français"]) {
    assert.ok(texte.includes(regle), `règle absente : « ${regle} »`);
  }
});

test("l'empreinte change avec le texte, même à version égale, et un fichier sans version est refusé", async () => {
  const dossier = await mkdtemp(join(tmpdir(), "rhea-"));
  const a = join(dossier, "a.md");
  const b = join(dossier, "b.md");
  await writeFile(a, "---\nversion: 3\n---\nTu es Rhéa.\n");
  await writeFile(b, "---\nversion: 3\n---\nTu es Rhéa !\n");
  assert.notEqual((await lirePromptSysteme(a)).empreinte, (await lirePromptSysteme(b)).empreinte);
  await writeFile(a, "Tu es Rhéa.\n");
  await assert.rejects(lirePromptSysteme(a), /version/);
});

test("un fichier aux fins de ligne CRLF (dépôt cloné sous Windows) se lit, avec la même empreinte", async () => {
  const dossier = await mkdtemp(join(tmpdir(), "rhea-"));
  const lf = join(dossier, "lf.md");
  const crlf = join(dossier, "crlf.md");
  await writeFile(lf, "---\nversion: 3\n---\nTu es Rhéa.\nRéponds en français.\n");
  await writeFile(crlf, "---\r\nversion: 3\r\n---\r\nTu es Rhéa.\r\nRéponds en français.\r\n");
  assert.deepEqual(await lirePromptSysteme(crlf), await lirePromptSysteme(lf));
});
