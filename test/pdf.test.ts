// Tests de l'extraction PDF. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { estScanne, lirePdf, lireTableau, pdfVersMarkdown, retirerRepetitions, texteDe, versMarkdown } from "../src/ingestion/pdf.ts";

const ligne = (y: number, taille: number, x: number, texte: string) => ({ y, taille, morceaux: [{ x, fin: x + 400, texte }] });
// Une ligne de tableau : plusieurs groupes de mots, chacun à l'abscisse de sa colonne
const rangee = (y: number, ...cellules: [number, string][]) =>
  ({ y, taille: 9, morceaux: cellules.map(([x, texte]) => ({ x, fin: x + 100, texte })) });

test("titres, paragraphes et listes sont reconstruits à partir des positions", () => {
  const page = [
    ligne(700, 20, 60, "Guide du télétravail"),
    ligne(650, 13, 60, "Article 1. Les jours"),
    ligne(620, 10, 60, "Vous pouvez télétravailler trois jours par"), // 15 points plus bas : même paragraphe
    ligne(605, 10, 60, "semaine, voir l'accord POL-TT-"),
    ligne(590, 10, 60, "02."),
    ligne(565, 10, 76, "un jour de présence commun ;"), // en retrait : un élément de liste
    ligne(547, 10, 76, "pas de télétravail à l'étranger."),
  ];
  assert.equal(
    versMarkdown([page]),
    "# Guide du télétravail\n\n## Article 1. Les jours\n\n" +
      "Vous pouvez télétravailler trois jours par semaine, voir l'accord POL-TT-02.\n" +
      "- un jour de présence commun ;\n- pas de télétravail à l'étranger.",
  );
});

test("un vrai PDF garde ses articles et ses références", async () => {
  const markdown = await pdfVersMarkdown("corpus/politiques/POL-NF-01.pdf");
  assert.match(markdown, /^# Politique notes de frais et déplacements$/m);
  assert.match(markdown, /^## Article 5\. Plafonds de repas et d'hébergement$/m);
  assert.match(markdown, /^### 12\.3 Perte d'un justificatif$/m);
  assert.match(markdown, /relèvent de la politique transport, mobilités durables et titres-restaurant \(POL-TP-01\)\./);
});

test("les en-têtes et pieds de page répétés disparaissent", () => {
  const page = (n: number, texte: string) => [
    ligne(800, 8, 60, "Kalyo · Guide du télétravail"),
    ligne(700, 10, 60, texte),
    ligne(30, 8, 60, `Page ${n} / 3`), // même signature sur chaque page : « Page # / # »
  ];
  const pages = retirerRepetitions([page(1, "Premier article."), page(2, "Deuxième article."), page(3, "Troisième article.")]);
  assert.deepEqual(pages.map((p) => p.map(texteDe)), [["Premier article."], ["Deuxième article."], ["Troisième article."]]);
});

test("un tableau est recollé rangée par rangée, même quand une cellule tient sur deux lignes", () => {
  const lignes = [
    rangee(700, [70, "Événement"], [220, "Durée"]),
    rangee(678, [70, "Mariage ou PACS"], [220, "5 jours ouvrés"]),
    rangee(656, [70, "Décès du conjoint ou du"], [220, "3 jours ouvrés"]),
    rangee(643, [70, "concubin"]), // 13 points plus bas : la suite de la rangée précédente
  ];
  assert.deepEqual(lireTableau(lignes, 0), {
    markdown:
      "| Événement | Durée |\n| --- | --- |\n| Mariage ou PACS | 5 jours ouvrés |\n| Décès du conjoint ou du concubin | 3 jours ouvrés |",
    fin: 4,
  });
  assert.equal(lireTableau(lignes, 3), undefined); // une seule colonne : pas un tableau
});

test("un paragraphe coupé par un saut de page est recollé", () => {
  const pages = [[ligne(90, 10, 60, "La demande se fait deux mois avant la date de")], [ligne(760, 10, 60, "début du congé.")]];
  assert.equal(versMarkdown(pages), "La demande se fait deux mois avant la date de début du congé.");
});

test("un vrai PDF perd ses en-têtes et garde ses tableaux", async () => {
  const frais = await pdfVersMarkdown("corpus/politiques/POL-NF-01.pdf");
  assert.match(frais, /^\| Repas avec un client \(par personne, boissons comprises\) \| 45 € \| 35 € \|$/m);
  assert.doesNotMatch(frais, /Page \d \/ 5|Document interne/);
  const conges = await pdfVersMarkdown("corpus/politiques/POL-CA-01.pdf");
  assert.equal(conges.match(/^\| Événement \| Durée \| Justificatif \|$/gm)?.length, 1); // en-tête répété après le saut de page
  assert.match(conges, /^\| Naissance ou adoption \| 3 jours ouvrés \(congé de naissance\), puis congé de paternité et d'accueil de l'enfant de 25 jours calendaires \| Acte de naissance ou jugement d'adoption \|$/m);
});

test("un PDF scanné est repéré, et refusé", async () => {
  assert.equal(estScanne(await lirePdf("corpus/politiques/POL-NF-01.pdf")), false);
  assert.equal(estScanne(await lirePdf("test/exemples/scan-pol-nf-01.pdf")), true);
  await assert.rejects(pdfVersMarkdown("test/exemples/scan-pol-nf-01.pdf"), /PDF scanné/);
});
