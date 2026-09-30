// Tests des métadonnées. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { charger, listerFichiers } from "../src/ingestion/chargeurs.ts";
import { detecterLangue, lierVersions, lireBalisesMeta, valider } from "../src/ingestion/metadonnees.ts";

test("les balises meta d'une page deviennent des métadonnées valides", () => {
  const html = `<html><head><title>Venir à vélo | Intranet Kalyo</title>
    <meta name="kalyo:id" content="INT-VELO"><meta name="kalyo:type" content="intranet">
    <meta name="kalyo:date_effet" content="2026-01-01"><meta name="kalyo:acces" content="tous">
    <meta name="kalyo:langue" content="fr"><meta name="kalyo:site" content="lyon,nantes"></head></html>`;
  assert.deepEqual(valider(lireBalisesMeta(html), "velo.html"), {
    id: "INT-VELO",
    titre: "Venir à vélo",
    type: "intranet",
    date_effet: "2026-01-01",
    acces: "tous",
    langue: "fr",
    site: ["lyon", "nantes"],
  });
});

test("des métadonnées incomplètes sont refusées, avec la raison", () => {
  assert.throws(
    () => valider({ id: "POL-XX-01", titre: "Sans date", type: "politique", acces: "tous", langue: "fr", site: ["lyon"] }, "x.pdf"),
    /x\.pdf : métadonnées invalides[\s\S]*date_effet/,
  );
  assert.throws(() => valider({ id: "POL-XX-01", acces: "public" }, "x.pdf"), /acces/);
});

test("la langue d'un ticket est détectée", () => {
  assert.equal(detecterLangue("Do I book the flight myself and is it ok for the hotel?"), "en");
  assert.equal(detecterLangue("je vais chez un client a Nantes, c'est pris en charge ?"), "fr");
});

test("tout le corpus a des métadonnées valides, et l'accord de 2023 sait qu'il est remplacé", async () => {
  const documents = (await Promise.all((await listerFichiers()).map(charger))).flat();
  lierVersions(documents);
  const parId = new Map(documents.map((d) => [d.id, d]));
  assert.equal(parId.size, documents.length); // aucun identifiant en double
  assert.equal(parId.get("POL-TT-01")!.metadonnees.remplace_par, "POL-TT-02");
  assert.equal(parId.get("INT-QUI-CONTACTER")!.titre, "Qui contacter ?");
  assert.equal(parId.get("FAQ-RH")!.metadonnees.type, "faq");
  assert.deepEqual(documents.filter((d) => d.metadonnees.langue === "en").map((d) => d.id), ["GRP-TRV-01", "TK-2026-0063", "TK-2026-0090"]);
  assert.deepEqual(documents.filter((d) => d.metadonnees.acces === "manager").map((d) => d.id), ["MGR-EA-01", "MGR-PR-01", "MGR-RE-01"]);
});
