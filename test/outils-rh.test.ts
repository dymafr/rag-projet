// Tests des outils métier de Rhéa : le barème kilométrique, et le solde et les tickets sur une vraie base PostgreSQL,
// PGlite, chargée avec les salariés fictifs de corpus/soldes/soldes.sql. Pas de Docker, pas de LLM. Lancement : npm test
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { executer } from "../src/agent/boucle.ts";
import { calculerIndemniteKm, consulterProfil, consulterSolde, ouvrirTicket } from "../src/agent/outils-rh.ts";
import { indemnite } from "../src/rh/bareme.ts";
import { moisRevolus, SCHEMA_DEMANDES } from "../src/rh/donnees.ts";

let base: PGlite;
before(async () => {
  base = await PGlite.create();
  await base.exec(await readFile("corpus/soldes/soldes.sql", "utf8")); // exec : plusieurs instructions d'un bloc
  await base.exec(SCHEMA_DEMANDES);
});
after(() => base.close());

test("indemnite applique la tranche de la distance annuelle, même quand le trajet la fait changer", () => {
  assert.equal(indemnite(320, 6), 212.8); // 320 × 0,665
  assert.equal(indemnite(200, 5), 127.2); // l'exemple de la politique : 200 × 0,636
  assert.equal(indemnite(320, 6, 4900), 150.78); // (5 220 × 0,374 + 1 457) − 4 900 × 0,665
  assert.equal(indemnite(100, 2), indemnite(100, 3)); // « 3 CV et moins »
  assert.equal(indemnite(100, 11), indemnite(100, 7)); // « 7 CV et plus »
});

test("calculer_indemnite_km donne le montant d'un premier trajet et rappelle que la tranche dépend de l'année", async () => {
  const { texte } = await calculerIndemniteKm().executer({ km: 320, puissance_cv: 6 }, { date: "2026-10-13" });
  assert.match(texte, /212,80\s€/);
  assert.match(texte, /320 × 0,665/);
  assert.match(texte, /Au-delà de 5 000 km dans l'année/);
});

test("consulter_solde lit le solde du salarié de la session, et rien sans salarié connecté", async () => {
  const outil = consulterSolde(base);
  const { texte } = await outil.executer({}, { date: "2026-10-13", matricule: "K0101" });
  assert.match(texte, /matricule K0101/);
  assert.match(texte, /9 jours restants \(10 acquis, 1 pris\)/);
  assert.match(texte, /12 jours, à poser avant le 31 mai 2027/);
  const anonyme = await outil.executer({}, { date: "2026-10-13" });
  assert.match(anonyme.texte, /Aucun salarié n'est connecté/);
});

test("consulter_solde ne donne pas de RTT à un salarié qui n'est pas au forfait jours", async () => {
  const { texte } = await consulterSolde(base).executer({}, { date: "2026-10-13", matricule: "K0012" });
  assert.match(texte, /pas au forfait jours/);
});

test("un matricule écrit par le LLM ne remplace jamais celui de la session", async () => {
  // Le LLM ajoute un matricule aux arguments : zod l'écarte (champ inconnu), et l'outil lit celui de la session
  const appel = { id: "a", nom: "consulter_solde", arguments: { matricule: "K0042" } };
  const { resultat, erreur } = await executer(appel, [consulterSolde(base)], { date: "2026-10-13", matricule: "K0101" });
  assert.equal(erreur, false);
  assert.match(resultat.texte, /matricule K0101/);
  assert.doesNotMatch(resultat.texte, /K0042/);
});

test("ouvrir_ticket enregistre la demande au nom du salarié connecté, et refuse une catégorie inconnue", async () => {
  const outil = ouvrirTicket(base);
  const contexte = { date: "2026-10-13", matricule: "K0101" };
  const args = { categorie: "Paie", objet: "Astreintes absentes de la paie", message: "Mes deux astreintes de septembre n'apparaissent pas sur ma fiche de paie." };
  const { texte } = await outil.executer(args as never, contexte);
  assert.match(texte, /^Ticket n° 1 ouvert dans la catégorie « Paie »/);
  const { rows } = await base.query<{ matricule: string; statut: string }>("SELECT matricule, statut FROM demandes_rh");
  assert.deepEqual(rows, [{ matricule: "K0101", statut: "ouverte" }]);
  const refuse = await executer({ id: "t", nom: "ouvrir_ticket", arguments: { ...args, categorie: "Salaires" } }, [outil], contexte);
  assert.ok(refuse.erreur && /categorie/.test(refuse.resultat.texte));
});

test("moisRevolus compte un mois quand son jour anniversaire est atteint", () => {
  assert.equal(moisRevolus("2026-04-29", "2026-10-13"), 5);
  assert.equal(moisRevolus("2026-04-29", "2026-10-29"), 6);
  assert.equal(moisRevolus("2025-08-19", "2026-10-13"), 13);
  assert.equal(moisRevolus("2026-01-31", "2026-02-28"), 1); // le dernier jour de février
  assert.equal(moisRevolus("2026-04-29", "2026-01-01"), 0); // avant l'entrée
});

test("consulter_profil donne la situation du salarié de la session, avec son ancienneté à la date du jour", async () => {
  const { texte } = await consulterProfil(base).executer({}, { date: "2026-10-13", matricule: "K0022" });
  assert.match(texte, /matricule K0022/);
  assert.match(texte, /manager : Marine Marchand/);
  assert.match(texte, /entré chez Kalyo le 2026-04-29 : 5 mois d'ancienneté révolus au 2026-10-13/);
  const anonyme = await consulterProfil(base).executer({}, { date: "2026-10-13" });
  assert.match(anonyme.texte, /Aucun salarié n'est connecté/);
});
