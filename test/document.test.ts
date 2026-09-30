// Tests du modèle de document commun et du dédoublonnage. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { charger, listerFichiers } from "../src/ingestion/chargeurs.ts";
import { dedoublonner, empreinte, normaliser, type Document } from "../src/ingestion/document.ts";
import { htmlVersMarkdown } from "../src/ingestion/html.ts";

test("un même texte s'écrit toujours avec les mêmes caractères", () => {
  assert.equal(normaliser("Plafond\u00a0:  45\u202f€\r\n\r\n\r\n\r\nParis "), "Plafond : 45 €\n\nParis");
  assert.equal(normaliser("Conge\u0301s"), "Congés"); // « e » suivi d'un accent devient « é »
  assert.equal(empreinte(normaliser("Congés  payés\r\n")), empreinte(normaliser("Congés payés")));
});

const doc = (id: string, texte: string): Document => ({ id, source: `${id}.pdf`, titre: id, texte, metadonnees: {} });

test("un doublon est écarté, deux versions d'un accord sont gardées", () => {
  const { uniques, doublons } = dedoublonner([
    doc("POL-TT-01", "Deux jours de télétravail par semaine."),
    doc("POL-TT-02", "Trois jours de télétravail par semaine."),
    doc("POL-TT-02 (1)", "Trois jours de télétravail par semaine."),
  ]);
  assert.deepEqual(uniques.map((d) => d.id), ["POL-TT-01", "POL-TT-02"]);
  assert.deepEqual(doublons.map((d) => [d.doublon.id, d.original.id]), [["POL-TT-02 (1)", "POL-TT-02"]]);
});

test("une page enregistrée deux fois, avec un autre menu, a la même empreinte une fois nettoyée", () => {
  const page = (menu: string) => `<header><nav>${menu}</nav></header><main><h1>Venir à vélo</h1><p>300 € par an.</p></main>`;
  const [a, b] = [page("Accueil"), page("Accueil · Actualités · Lyon")].map((html) => empreinte(normaliser(htmlVersMarkdown(html))));
  assert.equal(a, b);
});

test("tout le corpus se charge : 16 PDF, 15 pages, la FAQ et 95 tickets, sans doublon", async () => {
  const documents = (await Promise.all((await listerFichiers()).map(charger))).flat();
  assert.equal(documents.length, 16 + 15 + 1 + 95);
  assert.equal(dedoublonner(documents).doublons.length, 0);
  const frais = documents.find((d) => d.id === "POL-NF-01")!;
  assert.equal(frais.titre, "Politique notes de frais et déplacements");
  assert.equal(frais.source, "corpus/politiques/POL-NF-01.pdf");
});
