// Tests du calendrier de Kalyo (chapitre 14, leçon 5) : les jours fériés lus dans la page de l'intranet, le jour de la
// semaine, le compte des jours ouvrés, et l'outil de l'agent. Sans LLM ni base. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { consulterCalendrier } from "../src/agent/outils-rh.ts";
import { finDuMessage } from "../src/generation/prompt.ts";
import { calendrier, libelleDuJour, lireJoursFeries } from "../src/rh/calendrier.ts";

// Un extrait de la page « Jours fériés 2026 » telle qu'elle est indexée (INT-JOURS-FERIES#2)
const PAGE = [
  "# Jours fériés 2026",
  "",
  "| Date | Jour | Fête | Chez Kalyo |",
  "| --- | --- | --- | --- |",
  "| 1er janvier | jeudi | Jour de l'an | Chômé |",
  "| 25 mai | lundi | Lundi de Pentecôte | Travaillé (journée de solidarité) |",
  "| 15 août | samedi | Assomption | Tombe un samedi |",
  "| 11 novembre | mercredi | Armistice de 1918 | Chômé |",
  "| 25 décembre | vendredi | Noël | Chômé |",
].join("\n");
const feries = lireJoursFeries(PAGE);

test("les jours fériés se lisent dans le tableau de la page, l'année dans son titre", () => {
  assert.deepEqual(feries.map((f) => [f.date, f.chome]), [["2026-01-01", true], ["2026-05-25", false], ["2026-08-15", false], ["2026-11-11", true], ["2026-12-25", true]]);
  assert.deepEqual(lireJoursFeries("| 1er janvier | jeudi | Jour de l'an | Chômé |"), []); // sans titre, pas d'année : rien
});

test("le jour de la semaine, en toutes lettres, aussi dans la date du message", () => {
  assert.equal(libelleDuJour("2026-11-09"), "lundi 9 novembre 2026");
  assert.ok(finDuMessage("Combien ?", "2026-11-09").startsWith("Date du jour : lundi 9 novembre 2026 (2026-11-09)\n\n"));
});

test("les jours ouvrés : du lundi au vendredi, hors jours fériés chômés ; la journée de solidarité reste ouvrée", () => {
  // Du lundi 21 au jeudi 31 décembre 2026 : 9 jours de semaine, moins Noël
  assert.equal(calendrier("2026-12-21", "2026-12-31", feries).ouvres, 8);
  const novembre = calendrier("2026-11-09", "2026-11-13", feries);
  assert.deepEqual(novembre.jours.map((j) => j.statut), ["ouvré", "ouvré", "férié chômé", "ouvré", "ouvré"]);
  assert.equal(novembre.jours[2].libelle, "mercredi 11 novembre 2026");
  assert.equal(calendrier("2026-05-25", "2026-05-25", feries).ouvres, 1);
});

test("l'outil rend une fiche citable, refuse une période trop longue et prévient quand une année manque", async () => {
  const base = { query: async () => ({ rows: [{ texte: PAGE }] }) } as never;
  const outil = consulterCalendrier(base);
  const contexte = { date: "2026-10-20", profil: "salarie" } as never;
  const r = await outil.executer({ du: "2026-12-21", au: "2026-12-31" }, contexte);
  assert.equal(r.passages?.[0].id, "CALENDRIER-2026-12-21-2026-12-31#1");
  assert.match(r.texte, /vendredi 25 décembre 2026 : férié chômé \(Noël\)/);
  assert.match(r.texte, /Jours ouvrés \(du lundi au vendredi, hors jours fériés chômés\) : 8\./);
  assert.match((await outil.executer({ du: "2026-01-01", au: "2026-12-31" }, contexte)).texte, /^Période refusée/);
  assert.match((await outil.executer({ du: "2027-01-04", au: "2027-01-08" }, contexte)).texte, /ne donne pas les jours fériés de 2027/);
});
