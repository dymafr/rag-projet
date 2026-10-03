// Tests du rangement des chunks dans PostgreSQL, avec une fausse base qui note les requêtes. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Document } from "../src/ingestion/document.ts";
import { insererParLots, ligne, parametres } from "../src/stockage/chunks.ts";

test("parametres numérote les valeurs d'un lot, ligne après ligne", () => {
  assert.equal(parametres(2, 3), "($1, $2, $3), ($4, $5, $6)");
});

test("ligne met le chunk, les métadonnées de son document et le vecteur dans l'ordre des colonnes", () => {
  const chunk = { id: "POL-TT-02#4", document: "POL-TT-02", titres: ["Avenant n° 2 à l'accord télétravail"], texte: "…", taille: 80 };
  const document: Document = {
    id: "POL-TT-02",
    source: "corpus/accords/avenant-2-teletravail.pdf",
    titre: "Avenant n° 2 à l'accord télétravail",
    texte: "…",
    metadonnees: {
      id: "POL-TT-02",
      titre: "Avenant n° 2 à l'accord télétravail",
      type: "accord",
      date_effet: "2026-03-01",
      remplace: "POL-TT-01",
      acces: "tous",
      langue: "fr",
      site: ["lyon", "nantes"],
    },
  };
  const valeurs = ligne(chunk, document, [0.5, -0.25]);
  assert.equal(valeurs.length, 11);
  assert.deepEqual(valeurs.slice(5), ["accord", "tous", "fr", ["lyon", "nantes"], "2026-03-01", "[0.5,-0.25]"]);
});

test("insererParLots envoie une requête INSERT par lot", async () => {
  const requetes: unknown[][] = [];
  const fausseBase = {
    query: async (_sql: string, valeurs: unknown[] = []) => {
      requetes.push(valeurs);
      return { rows: [] };
    },
  };
  const lignes = Array.from({ length: 5 }, (_, i) => Array<number>(11).fill(i));
  assert.equal(await insererParLots(fausseBase, lignes, 2), 3);
  assert.deepEqual(requetes.map((valeurs) => valeurs.length), [22, 22, 11]); // 2 lignes, 2 lignes, puis 1 ligne de 11 valeurs
});
