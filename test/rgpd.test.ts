// Tests des données personnelles (chapitre 13, leçon 3) : la minimisation des tickets, le registre des effacements
// appliqué par l'ingestion, l'effacement des chunks dans une vraie base (PGlite), et la liste des endroits où partent les
// données. Les tickets du corpus ne sont jamais affichés : seuls des comptes. Lancement : npm test
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import type { Config } from "../src/config.ts";
import type { Chunk } from "../src/decoupage/chunk.ts";
import { normaliser, type Document } from "../src/ingestion/document.ts";
import { ingerer } from "../src/ingestion/pipeline.ts";
import { chargerTickets, texteDuTicket } from "../src/ingestion/tickets.ts";
import { effacerDeLaBase, inscrire, lireEffacements, retirerDuJsonl } from "../src/rgpd/effacements.ts";
import { destinations } from "../src/rgpd/localisation.ts";
import { lireAnnuaire, masquer } from "../src/rgpd/minimisation.ts";
import { insererParLots, ligne } from "../src/stockage/chunks.ts";
import { creerTable } from "../src/stockage/schema.ts";

test("masquer retire coordonnées, IBAN, numéro de sécurité sociale et noms complets, et compte ce qu'il a masqué", () => {
  const { texte, masques } = masquer(
    "Rappelez-moi au 06 12 34 56 78 ou au +33 6 98 76 54 32, ou par claire.martin@exemple.fr. RIB : FR76 3000 6000 0112 3456 7890 189 ou DE89 3704 0044 0532 0130 00. " +
      "N° de sécurité sociale 2 85 07 69 123 456 78. Mon collègue Victor Laine est d'accord ; Victor aussi.",
    ["Victor Laine", "Claire Martin"],
  );
  assert.equal(
    texte,
    "Rappelez-moi au [téléphone] ou au [téléphone], ou par [adresse électronique]. RIB : [IBAN] ou [IBAN]. " +
      "N° de sécurité sociale [n° de sécurité sociale]. Mon collègue [nom] est d'accord ; Victor aussi.",
  );
  assert.deepEqual(masques, { IBAN: 2, "sécurité sociale": 1, "adresse électronique": 1, téléphone: 2, nom: 1 });
  // Un montant, une date, un article ne sont pas des numéros de téléphone
  assert.deepEqual(masquer("Le 12/03/2026, 25 jours ouvrés, article 12.3, plafond de 1 250 €.").masques, {});
  assert.deepEqual(masquer("Vol AF12 vers Lyon demain, à rembourser en note de frais.").masques, {}); // un vol n'est pas un IBAN
});

test("sur les tickets du corpus : l'annuaire donne 180 noms, et il ne reste ni téléphone ni nom de collègue à indexer", async () => {
  const noms = await lireAnnuaire();
  assert.equal(noms.length, 180);
  const tickets = (await chargerTickets()).filter((t) => t.statut === "clos" && t.reponse);
  const bilan: Record<string, number> = {};
  for (const t of tickets) {
    const { texte, masques } = masquer(normaliser(texteDuTicket(t)), noms);
    for (const [nom, n] of Object.entries(masques)) bilan[nom] = (bilan[nom] ?? 0) + (n > 0 ? 1 : 0);
    assert.doesNotMatch(texte, /\b0\d(?:[ .]?\d{2}){4}\b/, t.id);
  }
  assert.deepEqual(bilan, { téléphone: 14, nom: 5 }); // tickets concernés, par catégorie
});

// Un petit corpus : deux tickets, dont l'un inscrit au registre des effacements
async function corpus(t: TestContext) {
  const racine = await mkdtemp(join(tmpdir(), "rhea-rgpd-"));
  t.after(() => rm(racine, { recursive: true, force: true }));
  for (const dossier of ["politiques", "accords", "managers", "groupe", "intranet", "faq", "tickets"]) await mkdir(join(racine, dossier));
  const ticket = (id: string, message: string, sujet = `Question ${id}`) => ({
    id, date: "2026-06-01", site: "lyon", demandeur: { matricule: "K0199", prenom: "Test", nom: "Exemple" }, categorie: "Paie",
    sujet, message, reponse: "La réponse du service RH.", traite_par: "K0006", statut: "clos",
  });
  await writeFile(join(racine, "tickets", "tickets.json"), JSON.stringify([
    ticket("TK-2026-9101", "Combien de jours de télétravail ? Rappelez-moi au 06 12 34 56 78.", "Rappel au 06 98 76 54 32"),
    ticket("TK-2026-9102", "Ma demande, dont j'ai demandé l'effacement."),
  ]));
  const effacements = join(racine, "effacements.json");
  return { racine, sortie: join(racine, "sortie", "documents.jsonl"), journal: join(racine, "sortie", "ingestion.log"), effacements };
}

test("l'ingestion masque le téléphone et écarte un document inscrit au registre, même s'il est encore à la source", async (t) => {
  const options = await corpus(t);
  assert.equal((await ingerer(options)).documents.length, 2);
  assert.equal(await inscrire({ id: "TK-2026-9102", date: "2026-10-19", motif: "demande d'effacement" }, options.effacements), true);
  assert.equal(await inscrire({ id: "TK-2026-9102", date: "2026-10-20", motif: "encore" }, options.effacements), false); // déjà inscrit
  assert.deepEqual((await lireEffacements(options.effacements)).map((e) => e.id), ["TK-2026-9102"]);
  const bilan = await ingerer(options);
  assert.deepEqual([bilan.documents.map((d) => d.id), bilan.effaces, bilan.supprimes], [["TK-2026-9101"], ["TK-2026-9102"], ["TK-2026-9102"]]);
  assert.match(bilan.documents[0].texte, /Rappelez-moi au \[téléphone\]/);
  assert.equal(bilan.documents[0].titre, "Rappel au [téléphone]"); // le sujet, devenu le titre, est masqué aussi
  assert.match(await readFile(options.journal, "utf8"), /EFFACÉ TK-2026-9102 \(registre des effacements\)/);
});

test("un registre illisible arrête l'ingestion plutôt que de réindexer un document effacé", async (t) => {
  const options = await corpus(t);
  for (const illisible of ["[ pas du JSON", '["TK-2026-9102"]', '[{"identifiant": "TK-2026-9102"}]']) { // du JSON d'une autre forme aussi
    await writeFile(options.effacements, illisible);
    await assert.rejects(ingerer(options), (e: Error) => e instanceof SyntaxError && e.message.startsWith(`${options.effacements} illisible`), illisible);
  }
});

const doc = (id: string): Document => ({ id, source: `${id}.md`, titre: id, texte: "", metadonnees: { id, titre: id, type: "ticket", date_effet: "2026-06-01", acces: "rh", langue: "fr", site: ["lyon"] } });
const chunk = (id: string): Chunk => ({ id, document: id.split("#")[0], titres: [id], texte: "…", taille: 1 });

test("l'effacement retire les lignes du document des fichiers JSONL et ses chunks de la base", async (t) => {
  const dossier = await mkdtemp(join(tmpdir(), "rhea-effacer-"));
  t.after(() => rm(dossier, { recursive: true, force: true }));
  const fichier = join(dossier, "chunks.jsonl");
  await writeFile(fichier, ["TK-2026-0066#1", "TK-2026-0066#2", "TK-2026-0067#1"].map((id) => JSON.stringify(chunk(id)) + "\n").join(""));
  assert.equal(await retirerDuJsonl(fichier, "TK-2026-0066"), 2);
  assert.equal(await retirerDuJsonl(join(dossier, "absent.jsonl"), "TK-2026-0066"), 0);
  assert.deepEqual((await readFile(fichier, "utf8")).trim().split("\n").map((l) => JSON.parse(l).id), ["TK-2026-0067#1"]);

  const base = await PGlite.create({ extensions: { vector } });
  t.after(() => base.close());
  await base.exec("CREATE EXTENSION IF NOT EXISTS vector");
  await creerTable(base, 2);
  await insererParLots(base, ["TK-2026-0066#1", "TK-2026-0066#2", "TK-2026-0067#1"].map((id) => ligne(chunk(id), doc(id.split("#")[0]), [1, 0], null)));
  assert.deepEqual(await effacerDeLaBase(base, "TK-2026-0066"), ["TK-2026-0066#1", "TK-2026-0066#2"]);
  assert.deepEqual((await base.query<{ id: string }>("SELECT id FROM chunks")).rows.map((r) => r.id), ["TK-2026-0067#1"]);
});

test("destinations : tout reste ici avec la configuration locale ; un fournisseur en ligne ou un modèle cloud sort", () => {
  const local = {
    LLM_PROVIDER: "ollama", LLM_MODEL: "modele-local", EMBEDDING_PROVIDER: "transformers", EMBEDDING_MODEL: "embeddings-locaux",
    RERANK_MODEL: "reclasseur-local", OLLAMA_BASE_URL: "http://localhost:11434", DATABASE_URL: "postgres://rhea:rhea@localhost:5433/rhea",
  } as Config;
  assert.ok(destinations(local).every((d) => d.locale), JSON.stringify(destinations(local)));
  assert.deepEqual(destinations(local).map((d) => d.brique), ["génération", "juge d'évaluation", "embeddings", "reclassement", "vision", "base de données"]);
  const enLigne = destinations({ ...local, LLM_PROVIDER: "anthropic", LLM_MODEL: "modele-heberge", VISION_MODEL: "vision:cloud" });
  assert.deepEqual(enLigne.filter((d) => !d.locale).map((d) => d.ou), [
    "les serveurs d'Anthropic (modele-heberge)",
    "les serveurs d'Anthropic (modele-heberge)",
    "les serveurs d'Ollama (modèle vision:cloud)",
  ]);
  // Chapitre 14 : le reclassement par le LLM et la contextualisation partent chez leur fournisseur ; leçon 5 : le LLM des
  // étapes de la recherche aussi
  assert.equal(destinations(local).find((d) => d.brique === "reclassement")?.ou, "aucun (RECLASSEMENT=non)");
  const etapes = destinations({ ...local, LLM_PROVIDER: "anthropic", LLM_MODEL: "grand", RECLASSEMENT: true, RERANK_PROVIDER: "llm", LLM_RECHERCHE_PROVIDER: "openai", LLM_RECHERCHE_MODEL: "petit", CONTEXTUALISER: true });
  assert.deepEqual(etapes.filter((d) => /contextualisation|reclassement|filtres/.test(d.brique)).map((d) => `${d.brique} : ${d.ou}`), [
    "contextualisation des passages : les serveurs d'OpenAI (petit)",
    "reclassement : les serveurs d'OpenAI (petit)",
    "filtres extraits et condensation : les serveurs d'OpenAI (petit)",
  ]);
});
