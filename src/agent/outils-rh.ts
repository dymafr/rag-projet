// Les outils métier de Rhéa : le solde de congés du salarié connecté, l'indemnité d'un trajet en voiture personnelle,
// l'ouverture d'un ticket dans l'espace RH, et (chapitre 14) le calendrier. Le LLM choisit l'outil et écrit les arguments ; l'identité du salarié, elle,
// vient toujours du contexte (la session), jamais d'un argument : sinon, une question bien tournée suffirait pour lire
// le solde d'un collègue ou ouvrir un ticket à son nom
import { z } from "zod";
import { baliser } from "../generation/prompt.ts";
import { detail, indemnite } from "../rh/bareme.ts";
import { calendrier, libelleDuJour, lireJoursFeries } from "../rh/calendrier.ts";
import { CATEGORIES, lireProfil, lireSolde, moisRevolus, ouvrirDemande } from "../rh/donnees.ts";
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
      "Donne le solde de congés payés et de RTT du salarié qui pose la question. Sans paramètre : le salarié est celui de " +
      "la session ; le solde d'un autre salarié ne peut pas être consulté.",
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

// Leçon 4 : une deuxième source, la table des salariés. Une règle qui dépend de la situation du salarié (ancienneté,
// site, temps partiel) demande deux appels : la règle dans les documents, la situation dans la base
export const consulterProfil = (base: Base) =>
  definirOutil({
    nom: "consulter_profil",
    description:
      "Donne la situation du salarié qui pose la question (et de lui seul) : site, service, poste, manager, date d'entrée " +
      "et ancienneté, temps de travail, forfait jours. Sans paramètre : le salarié est celui de la session. Quand une règle " +
      "dépend de cette situation (ancienneté, site, temps partiel), appelez aussi chercher_documents pour la règle.",
    parametres: z.object({}),
    async executer(_args, contexte) {
      const matricule = connecte(contexte);
      if (!matricule) return { texte: ANONYME };
      const p = await lireProfil(base, matricule);
      if (!p) return { texte: `Aucun salarié trouvé pour le matricule ${matricule}.` };
      const mois = moisRevolus(p.date_entree, contexte.date);
      const anciennete = mois >= 12 ? `${Math.floor(mois / 12)} an(s) et ${mois % 12} mois` : `${mois} mois`;
      const texte = [
        `Profil du salarié connecté (matricule ${p.matricule}) :`,
        `- site : ${p.site === "lyon" ? "Lyon" : "Nantes"} ; service : ${p.service} ; poste : ${p.poste} ; manager : ${p.manager ?? "aucun"} ;`,
        `- entré chez Kalyo le ${p.date_entree} : ${anciennete} d'ancienneté révolus au ${contexte.date} ;`,
        `- temps de travail : ${p.temps_travail} % ; forfait jours : ${p.forfait_jours ? "oui" : "non"}.`,
      ].join("\n");
      return { texte };
    },
  });

export const calculerIndemniteKm = () =>
  definirOutil({
    nom: "calculer_indemnite_km",
    description:
      "Calcule l'indemnité kilométrique d'un trajet professionnel en voiture personnelle, avec le barème de la politique " +
      "notes de frais de Kalyo. Ne faites jamais ce calcul vous-même. Si la distance ou la puissance manque, demandez-la au salarié.",
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

// Chapitre 14, leçon 5 : le calendrier. Les jours fériés viennent de la page de l'intranet indexée (INT-JOURS-FERIES),
// pas du code : si le service RH la met à jour, l'outil suit à la prochaine indexation. Le résultat est une fiche
// citable, comme celle de l'organigramme
const JOURS_MAX = 92;
export const consulterCalendrier = (base: Base) =>
  definirOutil({
    nom: "consulter_calendrier",
    description:
      "Donne les jours d'une période : la date, le jour de la semaine, les week-ends et les jours fériés de Kalyo (chômés " +
      `ou travaillés), et le nombre de jours ouvrés (du lundi au vendredi, hors jours fériés chômés), sur ${JOURS_MAX} jours au plus. ` +
      "À appeler pour compter des jours de congé, situer un pont ou un délai, ou savoir quel jour tombe une date : ne faites " +
      "jamais ce calcul vous-même. Renvoie une fiche balisée, à citer par sa source entre crochets.",
    parametres: z.object({
      du: z.iso.date().describe("Le premier jour de la période, AAAA-MM-JJ"),
      au: z.iso.date().describe("Le dernier jour de la période (inclus), AAAA-MM-JJ"),
    }),
    async executer({ du, au }) {
      const jours = (Date.parse(au) - Date.parse(du)) / 86_400_000 + 1;
      if (jours < 1 || jours > JOURS_MAX) return { texte: `Période refusée : de 1 à ${JOURS_MAX} jours, du premier au dernier jour inclus.` };
      const { rows } = await base.query<{ texte: string }>("SELECT texte FROM chunks WHERE document = 'INT-JOURS-FERIES' ORDER BY id");
      const feries = rows.flatMap((r) => lireJoursFeries(r.texte));
      const annees = new Set(feries.map((f) => f.date.slice(0, 4)));
      const c = calendrier(du, au, feries);
      const lignes = c.jours.map((j) => `- ${j.libelle} : ${j.statut}${j.fete ? ` (${j.fete})` : ""}`);
      const inconnues = [...new Set([du.slice(0, 4), au.slice(0, 4)])].filter((a) => !annees.has(a));
      const passage = {
        id: `CALENDRIER-${du}-${au}#1`,
        document: `CALENDRIER-${du}-${au}`,
        titres: ["Calendrier de Kalyo", `du ${libelleDuJour(du)} au ${libelleDuJour(au)}`],
        texte: [
          ...lignes,
          `Jours ouvrés (du lundi au vendredi, hors jours fériés chômés) : ${c.ouvres}.`,
          inconnues.length
            ? `Attention : la documentation ne donne pas les jours fériés de ${inconnues.join(" et ")} ; seuls les week-ends sont comptés pour cette année.`
            : "Jours fériés : page « Jours fériés » de l'intranet (INT-JOURS-FERIES).",
        ].join("\n"),
        score: 1,
      };
      return { texte: baliser(passage), passages: [passage] };
    },
  });

export const ouvrirTicket = (base: Base) =>
  definirOutil({
    nom: "ouvrir_ticket",
    description:
      "Ouvre un ticket dans l'espace RH, au nom du salarié connecté. À appeler dès que le salarié demande d'ouvrir un " +
      "ticket, avec ce qu'il a dit, sans lui redemander son accord : l'appel crée le ticket, l'annoncer sans appeler ne " +
      "crée rien. Ne l'appelez pas s'il ne l'a pas demandé.",
    parametres: z.object({
      categorie: z.enum(CATEGORIES).describe("La catégorie du ticket dans l'espace RH"),
      objet: z.string().trim().min(5).max(120).describe("L'objet du ticket, en une ligne"),
      message: z.string().trim().min(10).max(2000).describe("La demande du salarié, reformulée clairement, sans donnée de santé"),
    }),
    aConfirmer: ({ categorie, objet, message }) =>
      `ouvrir un ticket « ${categorie} » dans l'espace RH : « ${objet} », avec ce message : « ${message.replace(/\s+/g, " ")} »`,
    async executer({ categorie, objet, message }, contexte) {
      const matricule = connecte(contexte);
      if (!matricule) return { texte: "Aucun salarié n'est connecté : aucun ticket n'a été ouvert. Proposez de se connecter à l'espace RH." };
      const numero = await ouvrirDemande(base, { matricule, categorie, objet, message });
      return { texte: `Ticket n° ${numero} ouvert dans la catégorie « ${categorie} », objet « ${objet} ». Le service RH répondra dans l'espace RH.` };
    },
  });
