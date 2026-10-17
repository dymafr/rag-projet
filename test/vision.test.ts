// Tests de la lecture des documents scannés (chapitre 12, leçon 4) : les contrôles d'une note de frais lue par le modèle
// de vision, sur trois lectures réelles du 17 octobre (scan net, flou, très flou), et le circuit des transcriptions
// (fichier Markdown, empreinte, chargement). Le modèle de vision n'est pas appelé. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { charger } from "../src/ingestion/chargeurs.ts";
import { separerEntete } from "../src/ingestion/markdown.ts";
import { lireEnteteYaml, valider } from "../src/ingestion/metadonnees.ts";
import { controler, lireDate, type NoteDeFrais } from "../src/vision/note-de-frais.ts";
import { empreinteTranscrite, fichierTranscription } from "../src/vision/transcrire.ts";

const ligne = (date: string | null, nature: string, detail: string, montant: number | null) => ({ date, nature, detail, montant });
// La lecture du scan net : exacte
const nette: NoteDeFrais = {
  nom: "Moreau", prenom: "Morgane", matricule: "K0101", objet: "Atelier client à Paris",
  lignes: [
    ligne("06/10/26", "Transport", "TGV Lyon - Paris A/R", 112),
    ligne("06/10/26", "Hôtel", "1 nuit, petit déj. inclus", 148),
    ligne("06/10/26", "Repas", "Dîner seul", 24.5),
    ligne("07/10/26", "Repas", "Déjeuner client (2 pers.)", 82),
    ligne("07/10/26", "Transport", "Métro", 4.2),
  ],
  total: 370.7,
};
const jour = { date: "2026-10-17", matricule: "K0101" };
// Les montants formatés en français ont une espace fine insécable avant € : on la remplace par une espace ordinaire
const niveaux = (controles: { niveau: string; texte: string }[]) => controles.map((c) => `${c.niveau} : ${c.texte}`.replace(/[\u202f\u00a0]/g, " "));

test("une note lue sans erreur : seuls les dépassements de plafond ressortent", () => {
  const c = niveaux(controler(nette, jour));
  assert.equal(c.length, 2);
  assert.match(c[0], /^dépassement : ligne 2 \(1 nuit\(s\) d'hôtel à Paris\) : 148,00 € pour un plafond de 130,00 €, 18,00 €/);
  assert.match(c[1], /^dépassement : ligne 3 \(repas seul\) : 24,50 € pour un plafond de 20,00 €/);
  // Le déjeuner avec un client : 82 € pour 2 personnes à Paris, sous 2 × 45 €
  assert.ok(!c.some((t) => t.includes("ligne 4")));
});

test("le scan flou : un montant mal lu se voit à la somme, le matricule et les dates à leur forme", () => {
  const floue: NoteDeFrais = {
    ...nette,
    prenom: null,
    matricule: "KD101",
    lignes: [
      ligne("06/10/20", "Transport", "TGV Lyon - Paris A/R", 112),
      ligne("06/10/2", "Hôtel", "1 nuit, petit déj. inclus", 146), // 148 lu 146
      ...nette.lignes.slice(2).map((l) => ({ ...l, date: l.date!.slice(0, 7) })),
    ],
  };
  const c = niveaux(controler(floue, jour));
  assert.ok(c.includes("à relire : matricule illisible ou mal lu (KD101)"));
  assert.ok(c.some((t) => /^anomalie : ligne 1 : dépense du 2020-10-06, plus de 30 jours/.test(t)));
  assert.ok(c.includes("à relire : ligne 2 : date illisible (06/10/2)"));
  assert.ok(c.some((t) => /^anomalie : la somme des lignes \(368,70 €\) ne fait pas le total écrit \(370,70 €\)/.test(t)));
});

test("le scan très flou : une note inventée, au total cohérent, se trahit par ses dates et son identité", () => {
  const inventee: NoteDeFrais = {
    nom: "KALYO", prenom: null, matricule: null, objet: "Note de frais",
    lignes: [
      ligne("24/03/2023", "Transport", "Train Lyon - Paris", 112),
      ligne("24/03/2023", "Repas", "Restaurant", 45),
      ligne("24/03/2023", "Hébergement", "Hotel", 150),
      ligne("25/03/2023", "Transport", "Taxi", 25),
    ],
    total: 332,
  };
  const c = niveaux(controler(inventee, jour));
  assert.ok(!c.some((t) => t.includes("la somme des lignes"))); // 112 + 45 + 150 + 25 = 332 : la somme ne dit rien
  assert.ok(c.includes("à relire : matricule illisible ou mal lu (vide)"));
  assert.equal(c.filter((t) => /plus de 30 jours/.test(t)).length, 4);
});

test("controler signale une note au nom d'un autre salarié, et une date dans le futur", () => {
  const c = niveaux(controler({ ...nette, lignes: [ligne("20/10/26", "Transport", "Métro", 4.2)], total: 4.2 }, { date: "2026-10-17", matricule: "K0042" }));
  assert.ok(c.includes("anomalie : la note est au matricule K0101, pas à celui du salarié connecté (K0042)"));
  assert.ok(c.includes("anomalie : ligne 1 : date dans le futur (2026-10-20)"));
  // Un trajet par Paris ne fait pas d'une nuit à Lyon une nuit à Paris : plafond de 95 €, pas de 130 €
  const lyon = { ...nette, objet: "Formation à Lyon", lignes: [ligne("06/10/26", "Transport", "TGV Nantes - Paris - Lyon", 90), ligne("06/10/26", "Hôtel", "1 nuit à Lyon", 120)], total: 210 };
  assert.ok(niveaux(controler(lyon, jour)).some((t) => /^dépassement : ligne 2 \(1 nuit\(s\) d'hôtel\) : 120,00 € pour un plafond de 95,00 €/.test(t)));
});

test("lireDate lit JJ/MM/AA et JJ/MM/AAAA, et refuse une date incomplète ou impossible", () => {
  assert.equal(lireDate("06/10/26"), "2026-10-06");
  assert.equal(lireDate("6/10/2026"), "2026-10-06");
  assert.equal(lireDate("06/10/2"), null);
  assert.equal(lireDate("31/02/26"), null);
  assert.equal(lireDate(null), null);
});

test("une transcription : en-tête valide pour l'ingestion, empreinte de l'image relisible, relue à false", () => {
  const metadonnees = { id: "NS-TEST-01", titre: "Essai", type: "intranet", date_effet: "2026-10-12", acces: "tous", langue: "fr", site: ["nantes"] };
  const empreinte = "a".repeat(64);
  const fichier = fichierTranscription(metadonnees, { image: "corpus/scans/essai.jpg", empreinte, modele: "modele-test", date: "2026-10-17" }, "# Titre\n\nTexte.");
  const { entete, texte } = separerEntete(fichier);
  const brutes = lireEnteteYaml(entete) as Record<string, unknown>;
  assert.equal(valider(brutes, "essai").id, "NS-TEST-01");
  assert.equal(brutes.relue, false);
  assert.equal(empreinteTranscrite(fichier), empreinte);
  assert.equal(texte, "# Titre\n\nTexte.");
});

test("la note de service scannée, relue, se charge comme un document de l'intranet du site de Nantes", async () => {
  const [doc] = await charger("corpus/scans/NS-NA-2026-07.md");
  assert.equal(doc.id, "NS-NA-2026-07");
  assert.equal(doc.metadonnees.type, "intranet");
  assert.deepEqual(doc.metadonnees.site, ["nantes"]);
  assert.match(doc.texte, /l'abri à vélos de la cour est fermé/);
  assert.match(doc.texte, /du lundi 2 novembre au vendredi 13 novembre 2026/);
});
