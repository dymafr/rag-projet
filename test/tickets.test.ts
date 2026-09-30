// Tests de l'ingestion des tickets RH. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { chargerTickets, donneesPersonnelles, nettoyer, texteDuTicket, type Ticket } from "../src/ingestion/tickets.ts";

const ticket: Ticket = {
  id: "TK-TEST",
  date: "2026-05-04",
  site: "lyon",
  demandeur: { matricule: "K0999", prenom: "Léa", nom: "Martin" },
  categorie: "Congés et absences",
  sujet: "enfant malade",
  message: "Bjr, mon fils a de la fievre, je pose quoi ? Merci d'avance. Léa\n\nEnvoyé depuis mon téléphone",
  reponse: "Bonjour Léa,\n\nPosez le code EMA dans l'espace RH.\n\nBien cordialement,\nNora Leblanc, service RH",
  traite_par: "K0006",
  statut: "clos",
};

test("seules la question et la réponse sont indexées, sans formules ni signatures", () => {
  assert.equal(
    texteDuTicket(ticket),
    "Question : mon fils a de la fievre, je pose quoi ?\n\nRéponse du service RH : Posez le code EMA dans l'espace RH.",
  );
  // Sans virgule après « Bonjour », avec « remercie » (pas « merci ») et un prénom accentué en signature
  const eloise = { ...ticket, demandeur: { ...ticket.demandeur, prenom: "Éloïse" } };
  assert.equal(nettoyer("Bonjour je voudrais poser des CP. Je vous remercie. Éloïse", eloise), "je voudrais poser des CP. Je vous remercie");
  assert.equal(nettoyer("Bonjour Je pose quoi ?", ticket), "Je pose quoi ?"); // un mot à majuscule sans ponctuation n'est pas un prénom
});

test("les données personnelles sont repérées", () => {
  assert.deepEqual(donneesPersonnelles("Léa, joignable au 06 39 98 27 14, arrêt de travail", ticket), ["nom", "téléphone", "santé"]);
  assert.deepEqual(donneesPersonnelles(texteDuTicket(ticket), ticket), ["santé"]); // le prénom est parti avec les formules
});

test("les vrais tickets : 95 à indexer, sans le nom de leur demandeur", async () => {
  const tickets = await chargerTickets();
  const aIndexer = tickets.filter((t) => t.statut === "clos" && t.reponse);
  assert.equal(tickets.length, 100);
  assert.equal(aIndexer.length, 95);
  assert.ok(aIndexer.every((t) => !donneesPersonnelles(texteDuTicket(t), t).includes("nom")));
});
