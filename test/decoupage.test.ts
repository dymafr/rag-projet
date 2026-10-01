// Tests du découpage. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Document } from "../src/ingestion/document.ts";
import { decouperFixe } from "../src/decoupage/fixe.ts";
import { enCaracteres } from "../src/decoupage/mesure.ts";
import { blocs, collerIntroductions, decouperDocument, redecouper, sections } from "../src/decoupage/structure.ts";
import { contextualiser, texteAVectoriser } from "../src/decoupage/contexte.ts";
import type { Llm } from "../src/llm.ts";

const phrase = "Un repas avec un client est remboursé dans la limite de 45 euros à Paris.";

test("à taille fixe, chaque chunk tient dans la taille et aucun mot n'est coupé", () => {
  assert.deepEqual(decouperFixe(phrase, 20), ["Un repas avec un", "client est", "remboursé dans la", "limite de 45 euros", "à Paris."]);
});

test("avec un chevauchement, chaque chunk reprend la fin du précédent", () => {
  assert.deepEqual(decouperFixe(phrase, 30, 10), [
    "Un repas avec un client est",
    "est remboursé dans la limite",
    "la limite de 45 euros à",
    "euros à Paris.",
  ]);
});

test("la taille se mesure aussi en tokens : il suffit de changer de mesure", () => {
  const mots = (texte: string) => texte.trim().split(/\s+/).length; // une mesure jouet : un token par mot
  assert.deepEqual(decouperFixe(phrase, 5, 0, mots), ["Un repas avec un client", "est remboursé dans la limite", "de 45 euros à Paris."]);
});

const guide = [
  "# Guide du développeur",
  "## Installer",
  "Lancez la commande suivante.",
  "",
  "```bash",
  "# installe les dépendances",
  "npm install",
  "",
  "npm test",
  "```",
  "## Configurer",
  "### Le fichier .env",
  "Copiez .env.example en .env.",
].join("\n");

test("les sections suivent les titres, pas les commentaires d'un bloc de code", () => {
  assert.deepEqual(
    sections(guide).map((section) => section.titres),
    [
      ["Guide du développeur", "Installer"],
      ["Guide du développeur", "Configurer", "Le fichier .env"],
    ],
  );
});

test("un bloc de code reste entier, même avec une ligne vide", () => {
  assert.deepEqual(blocs(sections(guide)[0].corps), ["Lancez la commande suivante.", "```bash\n# installe les dépendances\nnpm install\n\nnpm test\n```"]);
});

test("un paragraphe trop grand est redécoupé aux fins de phrase", () => {
  const paragraphe = "Le train se prend en 2de classe. La 1re classe est remboursée si elle coûte moins cher. Réservez tôt.";
  assert.deepEqual(
    redecouper(paragraphe, 70, enCaracteres).map((morceau) => morceau.trim()),
    ["Le train se prend en 2de classe.", "La 1re classe est remboursée si elle coûte moins cher. Réservez tôt."],
  );
});

const doc = (id: string, texte: string): Document => ({
  id,
  source: `${id}.pdf`,
  titre: "Politique de test",
  texte,
  metadonnees: { id, titre: "Politique de test", type: "politique", date_effet: "2026-01-01", acces: "tous", langue: "fr", site: ["lyon"] },
});

test("un chunk ne mélange jamais deux sections et tient dans la taille", () => {
  const texte = "# Politique de test\n## Article 1. Objet\nPremier paragraphe.\n\nDeuxième paragraphe.\n## Article 2. Repas\nVingt euros.";
  const chunks = decouperDocument(doc("POL-XX-01", texte), 100, enCaracteres);
  assert.deepEqual(
    chunks.map((chunk) => [chunk.id, chunk.titres.at(-1), chunk.texte]),
    [
      ["POL-XX-01#1", "Article 1. Objet", "## Article 1. Objet\n\nPremier paragraphe.\n\nDeuxième paragraphe."],
      ["POL-XX-01#2", "Article 2. Repas", "## Article 2. Repas\n\nVingt euros."],
    ],
  );
  assert.ok(chunks.every((chunk) => chunk.taille <= 100));
  // un texte sans titre, comme un ticket : rattaché au titre du document
  const ticket = decouperDocument(doc("TK-1", "Question : où poser un CP ?"), 100, enCaracteres);
  assert.deepEqual(ticket.map((chunk) => chunk.titres), [["Politique de test"]]);
});

test("un tableau trop grand est coupé entre deux rangées, et chaque morceau garde la ligne des titres", () => {
  const tableau = "| Dépense | Paris | Autres villes |\n| --- | --- | --- |\n| Repas avec un client | 45 € | 35 € |\n| Repas seul | 20 € | 20 € |\n| Nuit d'hôtel | 130 € | 95 € |";
  assert.deepEqual(redecouper(tableau, 110, enCaracteres), [
    "| Dépense | Paris | Autres villes |\n| --- | --- | --- |\n| Repas avec un client | 45 € | 35 € |",
    "| Dépense | Paris | Autres villes |\n| --- | --- | --- |\n| Repas seul | 20 € | 20 € |",
    "| Dépense | Paris | Autres villes |\n| --- | --- | --- |\n| Nuit d'hôtel | 130 € | 95 € |",
  ]);
});

test("un tableau annoncé par une phrase garde la phrase et la ligne des titres dans chaque morceau", () => {
  const bloc = "Les plafonds sont les suivants :\n| Dépense | Paris |\n| --- | --- |\n| Repas avec un client | 45 € |\n| Nuit d'hôtel | 130 € |";
  assert.deepEqual(redecouper(bloc, 100, enCaracteres), [
    "Les plafonds sont les suivants :\n| Dépense | Paris |\n| --- | --- |\n| Repas avec un client | 45 € |",
    "Les plafonds sont les suivants :\n| Dépense | Paris |\n| --- | --- |\n| Nuit d'hôtel | 130 € |",
  ]);
});

test("une liste reste avec la phrase qui l'annonce, même coupée en deux", () => {
  const liste = collerIntroductions(["À la fin de votre contrat, vous recevez :", "- le certificat de travail ;\n- le solde de tout compte ;\n- l'attestation employeur."]);
  assert.equal(liste.length, 1);
  assert.deepEqual(redecouper(liste[0], 100, enCaracteres), [
    "À la fin de votre contrat, vous recevez :\n- le certificat de travail ;\n- le solde de tout compte ;",
    "À la fin de votre contrat, vous recevez :\n- l'attestation employeur.",
  ]);
  // une liste numérotée aussi
  const etapes = collerIntroductions(["Pour poser un congé :", "1. ouvrez l'outil RH ;\n2. choisissez les dates ;\n3. envoyez la demande."]);
  const morceaux = redecouper(etapes[0], 60, enCaracteres);
  assert.ok(morceaux.length > 1 && morceaux.every((morceau) => /^Pour poser un congé :\n\d\. /.test(morceau)));
});

test("on vectorise le chemin de titres, le contexte, puis le chunk", () => {
  const chunk = { id: "POL-NF-01#6", document: "POL-NF-01", titres: ["Politique notes de frais", "Article 5. Plafonds"], texte: "## Article 5. Plafonds\n\n| … |", taille: 10 };
  assert.equal(texteAVectoriser(chunk), "Politique notes de frais > Article 5. Plafonds\n\n## Article 5. Plafonds\n\n| … |");
  assert.equal(texteAVectoriser({ ...chunk, contexte: "Les plafonds de repas." }), "Politique notes de frais > Article 5. Plafonds\n\nLes plafonds de repas.\n\n## Article 5. Plafonds\n\n| … |");
});

test("chaque chunk reçoit son contexte, et le document ouvre chaque prompt", async () => {
  const debuts: string[] = [];
  const llm: Llm = async (debut, fin) => {
    debuts.push(debut);
    return { texte: ` Contexte de ${fin.match(/<chunk>\n(.*)\n/)![1]} `, usage: { entree: 100, enCache: debuts.length > 1 ? 80 : 0, sortie: 5 } };
  };
  const document = doc("POL-XX-01", "# Politique de test\n## Article 1\nPremier.\n## Article 2\nSecond.");
  const { chunks, usage } = await contextualiser(document, decouperDocument(document, 100, enCaracteres), llm);
  assert.deepEqual(chunks.map((chunk) => chunk.contexte), ["Contexte de ## Article 1", "Contexte de ## Article 2"]);
  assert.ok(debuts.every((debut) => debut === `<document>\n${document.texte}\n</document>`)); // le même début : il peut être mis en cache
  assert.deepEqual(usage, { entree: 200, enCache: 80, sortie: 10 });
});

test("une réponse de la FAQ garde sa question", () => {
  const faq = "# FAQ RH\n## Quel est le plafond pour un repas avec un client ?\n45 € par personne à Paris et 35 € dans les autres villes.";
  assert.equal(decouperDocument(doc("FAQ-RH", faq), 200, enCaracteres)[0].texte.split("\n")[0], "## Quel est le plafond pour un repas avec un client ?");
});
