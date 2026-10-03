// Tests du rangement des chunks dans PostgreSQL, avec une fausse base qui note les requêtes. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Document } from "../src/ingestion/document.ts";
import { dateDeFin, insererParLots, ligne, parametres } from "../src/stockage/chunks.ts";

// L'accord télétravail et l'avenant qui le remplace, réduits à leurs métadonnées
const accord: Document = {
  id: "POL-TT-01",
  source: "corpus/accords/accord-teletravail.pdf",
  titre: "Accord d'entreprise relatif au télétravail",
  texte: "…",
  metadonnees: {
    id: "POL-TT-01",
    titre: "Accord d'entreprise relatif au télétravail",
    type: "accord",
    date_effet: "2024-01-01",
    remplace_par: "POL-TT-02",
    acces: "tous",
    langue: "fr",
    site: ["lyon", "nantes"],
  },
};
const avenant: Document = {
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

test("parametres numérote les valeurs d'un lot, ligne après ligne", () => {
  assert.equal(parametres(2, 3), "($1, $2, $3), ($4, $5, $6)");
});

test("ligne met le chunk, les métadonnées de son document et le vecteur dans l'ordre des colonnes", () => {
  const chunk = { id: "POL-TT-02#4", document: "POL-TT-02", titres: ["Avenant n° 2 à l'accord télétravail"], texte: "…", taille: 80 };
  const valeurs = ligne(chunk, avenant, [0.5, -0.25], null);
  assert.equal(valeurs.length, 12);
  assert.deepEqual(valeurs.slice(5), ["accord", "tous", "fr", ["lyon", "nantes"], "2026-03-01", null, "[0.5,-0.25]"]);
});

test("dateDeFin : un document remplacé cesse de s'appliquer quand son remplaçant entre en vigueur", () => {
  const documents = new Map([accord, avenant].map((document) => [document.id, document]));
  assert.equal(dateDeFin(accord, documents), "2026-03-01");
  assert.equal(dateDeFin(avenant, documents), null); // aucun texte ne remplace l'avenant
});

test("insererParLots envoie une requête INSERT par lot", async () => {
  const requetes: unknown[][] = [];
  const fausseBase = {
    query: async (_sql: string, valeurs: unknown[] = []) => {
      requetes.push(valeurs);
      return { rows: [] };
    },
  };
  const lignes = Array.from({ length: 5 }, (_, i) => Array<number>(12).fill(i));
  assert.equal(await insererParLots(fausseBase, lignes, 2), 3);
  assert.deepEqual(requetes.map((valeurs) => valeurs.length), [24, 24, 12]); // 2 lignes, 2 lignes, puis 1 ligne de 12 valeurs
});
