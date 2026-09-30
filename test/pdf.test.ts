// Tests de l'extraction PDF. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { estScanne, lirePdf, pdfVersMarkdown, versMarkdown } from "../src/ingestion/pdf.ts";

const ligne = (y: number, taille: number, x: number, texte: string) => ({ y, taille, morceaux: [{ x, fin: x + 400, texte }] });

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

test("un PDF scanné est repéré, et refusé", async () => {
  assert.equal(estScanne(await lirePdf("corpus/politiques/POL-NF-01.pdf")), false);
  assert.equal(estScanne(await lirePdf("test/exemples/scan-pol-nf-01.pdf")), true);
  await assert.rejects(pdfVersMarkdown("test/exemples/scan-pol-nf-01.pdf"), /PDF scanné/);
});
