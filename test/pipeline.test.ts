// Tests du pipeline d'ingestion, sur un petit corpus copié dans un dossier temporaire. Lancement : npm test
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { appendFile, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { ingerer } from "../src/ingestion/pipeline.ts";

// Un petit corpus : une politique en PDF, une page de l'intranet, la FAQ ; les autres dossiers sont vides.
// Le dossier temporaire est supprimé à la fin du test, même si le test échoue
async function petitCorpus(t: TestContext) {
  const racine = await mkdtemp(join(tmpdir(), "rhea-corpus-"));
  t.after(() => rm(racine, { recursive: true, force: true }));
  for (const dossier of ["politiques", "accords", "managers", "groupe", "intranet", "faq", "tickets"]) {
    await mkdir(join(racine, dossier));
  }
  for (const fichier of ["politiques/POL-NF-01.pdf", "politiques/POL-NF-01.yaml", "intranet/venir-a-velo.html", "faq/faq-rh.md"]) {
    await copyFile(join("corpus", fichier), join(racine, fichier));
  }
  return { racine, sortie: join(racine, "sortie", "documents.jsonl"), journal: join(racine, "sortie", "ingestion.log") };
}

test("relancer l'ingestion ne crée aucun doublon et repère ce qui a changé", async (t) => {
  const options = await petitCorpus(t);

  const premier = await ingerer(options);
  assert.deepEqual(premier.nouveaux, ["FAQ-RH", "INT-VELO", "POL-NF-01"]);

  const second = await ingerer(options); // rien n'a changé
  assert.deepEqual([second.nouveaux, second.modifies, second.supprimes], [[], [], []]);
  assert.equal((await readFile(options.sortie, "utf8")).trim().split("\n").length, 3);

  await appendFile(join(options.racine, "faq/faq-rh.md"), "\n## Une nouvelle question ?\nSa réponse.\n");
  await rm(join(options.racine, "intranet/venir-a-velo.html"));
  const troisieme = await ingerer(options);
  assert.deepEqual([troisieme.modifies, troisieme.supprimes], [["FAQ-RH"], ["INT-VELO"]]);
});

test("un fichier en erreur est journalisé sans arrêter les autres", async (t) => {
  const options = await petitCorpus(t);
  await writeFile(join(options.racine, "politiques/POL-XX-01.pdf"), "ceci n'est pas un PDF");
  await copyFile(join(options.racine, "politiques/POL-NF-01.pdf"), join(options.racine, "politiques/POL-NF-01 (1).pdf"));

  const bilan = await ingerer(options);
  assert.equal(bilan.documents.length, 3);
  assert.deepEqual(bilan.erreurs.map((e) => basename(e.fichier)), ["POL-NF-01 (1).pdf", "POL-XX-01.pdf"]);
  assert.match(bilan.erreurs[0].message, /métadonnées manquantes/);
  assert.match(await readFile(options.journal, "utf8"), /documents 3, nouveaux 3, .*erreurs 2\n.*ERREUR .*POL-NF-01 \(1\)\.pdf.*\n.*ERREUR .*POL-XX-01\.pdf/);
});

test("deux textes différents ne peuvent pas porter le même identifiant", async (t) => {
  const options = await petitCorpus(t);
  // Le texte de POL-CA-01, avec les métadonnées de POL-NF-01 : un autre document, mais le même identifiant
  await copyFile(join("corpus", "politiques/POL-CA-01.pdf"), join(options.racine, "politiques/POL-NF-01-bis.pdf"));
  await copyFile(join(options.racine, "politiques/POL-NF-01.yaml"), join(options.racine, "politiques/POL-NF-01-bis.yaml"));

  const bilan = await ingerer(options);
  assert.equal(bilan.documents.length, 3);
  assert.equal(bilan.erreurs.length, 1);
  assert.match(bilan.erreurs[0].message, /POL-NF-01\.pdf : identifiant POL-NF-01 déjà pris par .*POL-NF-01-bis\.pdf/);
});
