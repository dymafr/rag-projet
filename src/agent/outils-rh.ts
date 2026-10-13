// Les outils métier de Rhéa : le solde de congés du salarié connecté, l'indemnité d'un trajet en voiture personnelle,
// l'ouverture d'un ticket dans l'espace RH. Le LLM choisit l'outil et écrit les arguments ; l'identité du salarié, elle,
// vient toujours du contexte (la session), jamais d'un argument : sinon, une question bien tournée suffirait pour lire
// le solde d'un collègue ou ouvrir un ticket à son nom
import { z } from "zod";
import { detail, indemnite } from "../rh/bareme.ts";
import { CATEGORIES, lireSolde, ouvrirDemande } from "../rh/donnees.ts";
import type { Base } from "../stockage/base.ts";
import { definirOutil, type Contexte } from "./outil.ts";

const nombre = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const euros = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

// Sans salarié connecté, les outils personnels ne font rien
const ANONYME = "Aucun salarié n'est connecté : cet outil ne peut rien consulter. Proposez de se connecter à l'espace RH.";
const connecte = (contexte: Contexte) => contexte.matricule;

export const consulterSolde = (base: Base) =>
  definirOutil({
    nom: "consulter_solde",
    description:
      "Donne le solde de congés payés et de RTT du salarié qui pose la question (et de lui seul). " +
      "Sans paramètre : le salarié est celui de la session.",
    parametres: z.object({}),
    async executer(_args, contexte) {
      const matricule = connecte(contexte);
      if (!matricule) return { texte: ANONYME };
      const s = await lireSolde(base, matricule);
      if (!s) return { texte: `Aucun solde trouvé pour le matricule ${matricule}.` };
      const rtt = s.forfait_jours
        ? `RTT de l'année civile : ${nombre(s.rtt_acquis - s.rtt_pris)} jours restants (${nombre(s.rtt_acquis)} acquis, ${nombre(s.rtt_pris)} pris), à poser avant le 31 décembre.`
        : "RTT : ce salarié n'est pas au forfait jours, il n'en a pas.";
      const texte = [
        `Solde du salarié connecté (matricule ${s.matricule}), mis à jour le ${s.maj_le} :`,
        `- congés payés acquis du 1er juin 2025 au 31 mai 2026 : ${nombre(s.cp_reliquat)} jours, à poser avant le 31 mai 2027 ;`,
        `- congés payés en cours d'acquisition depuis le 1er juin 2026 : ${nombre(s.cp_en_cours)} jours ;`,
        `- ${rtt}`,
      ].join("\n");
      return { texte };
    },
  });

export const calculerIndemniteKm = () =>
  definirOutil({
    nom: "calculer_indemnite_km",
    description:
      "Calcule l'indemnité kilométrique d'un trajet professionnel en voiture personnelle, avec le barème de la politique " +
      "notes de frais de Kalyo. Ne faites jamais ce calcul vous-même.",
    // Deux paramètres seulement : le cumul de l'année, que la tranche demande aussi, le LLM le réclamait au salarié
    // même facultatif. L'outil de notes de frais le connaît : l'outil le rappelle dans sa réponse
    parametres: z.object({
      km: z.number().positive().max(5000).describe("La distance du trajet, en kilomètres"),
      puissance_cv: z.number().int().min(1).max(50).describe("La puissance fiscale du véhicule, en chevaux fiscaux (CV), sur la carte grise"),
    }),
    async executer({ km, puissance_cv }) {
      const texte =
        `Indemnité pour ${nombre(km)} km avec un véhicule de ${puissance_cv} CV : ${euros(indemnite(km, puissance_cv))} ` +
        `(${detail(km, puissance_cv)}), si c'est le premier trajet professionnel de l'année. Au-delà de 5 000 km dans l'année, ` +
        "la tranche change : l'outil de notes de frais cumule les kilomètres et applique la bonne. Barème indicatif de la " +
        "politique notes de frais (POL-NF-01, article 9) ; le barème publié par l'administration fiscale fait foi."
      return { texte };
    },
  });

export const ouvrirTicket = (base: Base) =>
  definirOutil({
    nom: "ouvrir_ticket",
    description:
      "Ouvre un ticket dans l'espace RH, au nom du salarié connecté. À appeler dès que le salarié demande d'ouvrir un " +
      "ticket : l'appel crée le ticket, l'annoncer sans appeler ne crée rien.",
    parametres: z.object({
      categorie: z.enum(CATEGORIES).describe("La catégorie du ticket dans l'espace RH"),
      objet: z.string().trim().min(5).max(120).describe("L'objet du ticket, en une ligne"),
      message: z.string().trim().min(10).max(2000).describe("La demande du salarié, reformulée clairement, sans donnée de santé"),
    }),
    async executer({ categorie, objet, message }, contexte) {
      const matricule = connecte(contexte);
      if (!matricule) return { texte: "Aucun salarié n'est connecté : aucun ticket n'a été ouvert. Proposez de se connecter à l'espace RH." };
      const numero = await ouvrirDemande(base, { matricule, categorie, objet, message });
      return { texte: `Ticket n° ${numero} ouvert dans la catégorie « ${categorie} », objet « ${objet} ». Le service RH répondra dans l'espace RH.` };
    },
  });
