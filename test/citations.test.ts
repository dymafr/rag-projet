// Tests de la vérification des citations : une citation doit figurer dans le passage dont elle donne le numéro.
// Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { figureDans, normaliser, numerosDesSources, verifierCitations } from "../src/generation/citations.ts";
import type { Resultat } from "../src/recherche/vectorielle.ts";

const faq = "Le repas avec un client est remboursé dans la limite de **45 €** par personne à Paris et de 35 € par personne dans les autres villes, boissons comprises. Sur la note, indiquez le nom et la société de chaque invité.";
const tableau = "| Repas avec un client (par personne, boissons comprises) | 45 € | 35 € |";
const passages: Resultat[] = [faq, tableau].map((texte, i) => ({ id: `P#${i + 1}`, document: "P", titres: [], texte, score: 0.8 }));

test("normaliser ne garde que des mots, en minuscules : lettres, chiffres, % et €, séparés par une espace", () => {
  assert.equal(normaliser("  L’avenant   n° 2 **entre** en vigueur "), "l avenant n 2 entre en vigueur");
  assert.equal(normaliser("le mot «pause», la ﬁn"), normaliser("Le mot « pause », la fin"));
  assert.equal(normaliser("Réglé".normalize("NFD")), normaliser("Réglé"));
  assert.equal(normaliser("45€, 2,50 €"), "45 € 2 50 €");
});

test("figureDans retrouve une citation exacte, ou qui ne diffère que par la forme", () => {
  assert.ok(figureDans("dans la limite de 45 € par personne à Paris", faq));
  assert.ok(figureDans("Repas avec un client (par personne, boissons comprises)   45 €", tableau));
});

test("figureDans retrouve une citation de deux paragraphes recollés sans séparateur", () => {
  const deuxParagraphes = "Combien de jours de télétravail ai-je par semaine ?\n\nDepuis le 1er mars, trois jours par semaine.";
  assert.ok(figureDans("Combien de jours de télétravail ai-je par semaine ?Depuis le 1er mars, trois jours par semaine.", deuxParagraphes));
  const titreEtTexte = "## Le télétravail\n\nMis à jour le 1er mars 2026.";
  assert.ok(figureDans("## Le télétravailMis à jour le 1er mars 2026.", titreEtTexte)); // un titre finit sans ponctuation
});

test("figureDans accepte une citation abrégée si ses morceaux sont dans le passage, dans l'ordre", () => {
  assert.ok(figureDans("Le repas avec un client est remboursé [...] boissons comprises.", faq));
  assert.ok(!figureDans("boissons comprises [...] Le repas avec un client", faq));
});

test("figureDans refuse une citation abrégée en morceaux trop courts, qui peut inverser le sens", () => {
  const regle = "Vous ne pouvez pas télétravailler plus de trois jours par semaine.";
  assert.ok(!figureDans("Vous […] pouvez […] télétravailler plus de trois jours", regle));
  assert.ok(!figureDans("[...] pas [...]", regle));
});

test("figureDans refuse une citation inventée, modifiée, vide ou trop courte pour prouver quoi que ce soit", () => {
  assert.ok(!figureDans("dans la limite de 50 € par personne à Paris", faq));
  assert.ok(!figureDans("", faq));
  assert.ok(!figureDans("[2]", faq)); // un numéro de passage n'est pas une citation
});

test("figureDans compare des nombres entiers : un chiffre ajouté, retiré ou déplacé fait échouer", () => {
  assert.ok(!figureDans("5 € par personne dans les autres villes", faq)); // le passage dit 35 € : « 5 » n'est pas un mot
  assert.ok(!figureDans("250 € par jour de télétravail", "Kalyo verse 2,50 € par jour de télétravail."));
  assert.ok(!figureDans("Selon l'avenant n° 2", "Selon l'avenant n° 21, le télétravail passe à trois jours."));
});

test("verifierCitations vérifie chaque citation dans le passage de son numéro, pas dans un autre", () => {
  const resultat = verifierCitations(
    [
      { numero: 1, texteCite: "indiquez le nom et la société de chaque invité" },
      { numero: 2, texteCite: "indiquez le nom et la société de chaque invité" },
      { numero: 5, texteCite: "45 €" },
    ],
    passages,
  );
  assert.deepEqual(resultat.map((c) => c.trouvee), [true, false, false]);
});

test("numerosDesSources réunit les numéros du texte et des citations, et écarte ceux sans passage", () => {
  const citations = [{ numero: 2, texteCite: "45 €" }, { numero: 3, texteCite: "?" }];
  assert.deepEqual(numerosDesSources("Oui [1, 2], sauf à Paris [7].", citations, passages), [1, 2]);
});
