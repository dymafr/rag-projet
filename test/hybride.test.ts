// Tests de la recherche hybride sur PGlite, avec des vecteurs à deux dimensions écrits à la main : la question pointe
// vers [1, 0], et chaque passage a le vecteur qu'on lui donne. Lancement : npm test
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { vector } from "@electric-sql/pglite-pgvector";
import type { Chunk } from "../src/decoupage/chunk.ts";
import type { Document } from "../src/ingestion/document.ts";
import { chercherHybride } from "../src/recherche/hybride.ts";
import { insererParLots, ligne } from "../src/stockage/chunks.ts";
import { ajouterPleinTexte, creerTable } from "../src/stockage/schema.ts";

const document = (id: string): Document => ({
  id,
  source: `${id}.md`,
  titre: id,
  texte: "",
  metadonnees: { id, titre: id, type: "politique", date_effet: "2026-01-01", acces: "tous", langue: "fr", site: ["lyon"] },
});
const passage = (id: string, texte: string, vecteur: number[]) => {
  const chunk: Chunk = { id, document: id.split("#")[0], titres: [id], texte, taille: texte.split(" ").length };
  return ligne(chunk, document(chunk.document), vecteur, null);
};

let base: PGlite;

before(async () => {
  base = await PGlite.create({ extensions: { vector, unaccent } });
  await base.exec("CREATE EXTENSION IF NOT EXISTS vector");
  await creerTable(base, 2);
  await insererParLots(base, [
    passage("CA#1", "Les congés payés se posent dans l'espace RH.", [1, 0]), // le plus proche de la question
    passage("TT#1", "Le télétravail : trois jours par semaine.", [0.8, 0.6]), // cosinus 0,8
    passage("EM#1", "Le code EMA : un enfant malade, trois jours par an.", [0, 1]), // cosinus 0 : loin par le sens
  ]);
  await ajouterPleinTexte(base);
});

after(async () => {
  await base.close();
});

test("hybride : un passage trouvé par le seul plein texte entre dans la fusion, avec sa similarité cosinus", async () => {
  // Vectorielle (2 candidats) : CA#1, TT#1. Plein texte : EM#1, le seul qui contient « EMA ».
  // RRF : CA#1 1/61, EM#1 1/61 (à égalité, CA#1, cité par la première liste, passe devant), TT#1 1/62
  const resultats = await chercherHybride(base, "code EMA", [1, 0], 3, { acces: ["tous"] }, { candidats: 2, poids: [1, 1] });
  assert.deepEqual(resultats.map((r) => r.id), ["CA#1", "EM#1", "TT#1"]);
  // Le score reste la similarité cosinus avec la question, celle que compare le seuil d'abstention, même pour EM#1
  assert.deepEqual(resultats.map((r) => Number(r.score.toFixed(3))), [1, 0, 0.8]);
});

test("hybride : le poids d'une recherche change l'ordre, pas les scores", async () => {
  // Plein texte pesé 0,5 : EM#1 ne vaut plus que 0,5/61 et passe derrière TT#1 (1/62)
  const resultats = await chercherHybride(base, "code EMA", [1, 0], 3, { acces: ["tous"] }, { candidats: 2, poids: [1, 0.5] });
  assert.deepEqual(resultats.map((r) => r.id), ["CA#1", "TT#1", "EM#1"]);
});
