// Tests de la recherche plein texte sur une vraie base PostgreSQL, PGlite, avec l'extension unaccent : pas de Docker.
// Les passages sont écrits à la main, avec un vecteur factice (la recherche plein texte ne le lit pas). Lancement : npm test
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { vector } from "@electric-sql/pglite-pgvector";
import type { Chunk } from "../src/decoupage/chunk.ts";
import type { Document } from "../src/ingestion/document.ts";
import { chercherPleinTexte } from "../src/recherche/plein-texte.ts";
import { insererParLots, ligne } from "../src/stockage/chunks.ts";
import { ajouterPleinTexte, creerTable } from "../src/stockage/schema.ts";

const document = (id: string, acces: Document["metadonnees"]["acces"] = "tous", date_effet = "2026-01-01"): Document => ({
  id,
  source: `${id}.md`,
  titre: id,
  texte: "",
  metadonnees: { id, titre: id, type: "politique", date_effet, acces, langue: "fr", site: ["lyon", "nantes"] },
});
const passage = (id: string, texte: string, doc = document(id.split("#")[0])) => {
  const chunk: Chunk = { id, document: doc.id, titres: [doc.titre], texte, taille: texte.split(" ").length };
  return ligne(chunk, doc, [1, 0], null);
};

let base: PGlite;

before(async () => {
  base = await PGlite.create({ extensions: { vector, unaccent } });
  await base.exec("CREATE EXTENSION IF NOT EXISTS vector");
  await creerTable(base, 2);
  await insererParLots(base, [
    passage("CA#1", "Article 6. Le code EMA : un enfant malade, trois jours par an, avec un certificat médical."),
    passage("CA#2", "Si votre enfant a de la fièvre, prévenez votre manager. Les congés payés se posent dans l'espace RH."),
    passage("CA#3", "Article 2. Les congés payés : 25 jours ouvrés par an. Les congés se posent deux semaines à l'avance."),
    passage("NF#1", "12.3 Perte : en cas de perte d'un justificatif, une attestation sur l'honneur le remplace."),
    passage("NF#2", "Article 5 : les plafonds de repas. Article 7 : l'hébergement. Article 8 : le train."),
    passage("MG#1", "Le code EMA figure aussi dans la grille des managers.", document("MG", "manager")),
    passage("FU#1", "Le code EMA sera remplacé par un nouveau code.", document("FU", "tous", "2027-01-01")),
  ]);
  await ajouterPleinTexte(base); // après l'insertion : la colonne se calcule pour les lignes déjà là
});

after(async () => {
  await base.close();
});

const ids = (resultats: { id: string }[]) => resultats.map((r) => r.id);

test("un code exact : le passage qui contient EMA arrive en tête", async () => {
  const resultats = await chercherPleinTexte(base, "Que veut dire le code EMA ?", 3, { acces: ["tous"], enVigueurLe: "2026-10-01" });
  assert.equal(resultats[0].id, "CA#1");
  assert.ok(resultats[0].score > 0);
});

test("les accents et les pluriels ne comptent pas : « fievre » trouve « fièvre », « conges » trouve « congés »", async () => {
  assert.deepEqual(ids(await chercherPleinTexte(base, "fievre", 5)), ["CA#2"]);
  assert.deepEqual(new Set(ids(await chercherPleinTexte(base, "conges", 5))), new Set(["CA#2", "CA#3"]));
});

test("un mot rare pèse plus qu'un mot répété partout (l'IDF) : « 12.3 » l'emporte sur « article »", async () => {
  const resultats = await chercherPleinTexte(base, "Que dit l'article 12.3 ?", 2);
  assert.deepEqual(ids(resultats), ["NF#1", "NF#2"]); // sans IDF, NF#2, qui a trois fois « article », passerait devant
});

test("les filtres de la recherche vectorielle s'appliquent : accès et version en vigueur", async () => {
  const tous = ids(await chercherPleinTexte(base, "code EMA", 10));
  assert.ok(tous.includes("MG#1") && tous.includes("FU#1"));
  const filtres = ids(await chercherPleinTexte(base, "code EMA", 10, { acces: ["tous"], enVigueurLe: "2026-10-01" }));
  assert.deepEqual(filtres, ["CA#1"]);
});

test("une question faite de mots vides ne trouve rien ; un passage ajouté ensuite est cherchable tout de suite", async () => {
  // « à » et « été » sont écartés avant de perdre leur accent : sans accent, « à » deviendrait « a », qui est dans CA#2
  assert.deepEqual(await chercherPleinTexte(base, "à été que de c'est", 5), []);
  await ajouterPleinTexte(base); // une seconde fois : rien ne change
  await insererParLots(base, [passage("TP#1", "Le forfait mobilités durables rembourse un vélo.")]);
  assert.deepEqual(ids(await chercherPleinTexte(base, "velo", 5)), ["TP#1"]);
});
