// Rhéa telle qu'on la sert (chapitre 14) : l'agent du chapitre 10, avec ses outils et ses garde-fous des chapitres 12 et
// 13. Une seule fonction l'assemble, pour la ligne de commande, le serveur et l'évaluation : on mesure exactement ce que
// les salariés utilisent. Avant ce chapitre, le serveur servait encore le pipeline du chapitre 7, pendant que la ligne de
// commande et l'évaluation utilisaient l'agent : deux Rhéa différentes
import type pg from "pg";
import { llmAgentDeProduction, llmDeProduction, llmDeRecherche } from "../charge/production.ts";
import { config } from "../config.ts";
import { nomDuModele } from "../embeddings/fournisseurs.ts";
import { plancherPour } from "../generation/abstention.ts";
import { PASSAGES_DEMANDES } from "../generation/prompt.ts";
import { verifierReponse } from "../generation/verification.ts";
import { condenser } from "../recherche/conversation.ts";
import { trouverPassages } from "../recherche/passages.ts";
import type { Agent, Recherche } from "./boucle.ts";
import { chercherDocuments } from "./chercher.ts";
import { consulterOrganigramme } from "./organigramme.ts";
import { calculerIndemniteKm, consulterCalendrier, consulterProfil, consulterSolde, ouvrirTicket } from "./outils-rh.ts";
import { interrogerSoldes } from "./soldes-sql.ts";

export const PROMPT_AGENT = "prompts/rhea-agent.md";

export type OptionsRhea = {
  systeme: string; // le prompt de PROMPT_AGENT, lu une fois par l'appelant (lirePromptSysteme)
  matricule?: string; // le salarié connecté ; absent : la fiche de l'organigramme n'est pas consultée d'office
  recherche?: Recherche; // secours par défaut : le choix du chapitre 10
  toursMax?: number;
  confirmer?: Agent["confirmer"]; // absent : aucune action ne s'exécute
  journaliser?: Agent["journaliser"];
};

// Les outils ne dépendent que de la base : on les crée une fois, et chaque question les réutilise
export function outilsDeRhea(pool: pg.Pool) {
  return [
    // Leçon 4 : le plancher de similarité du modèle d'embedding de .env
    chercherDocuments((requete, date, profil) => trouverPassages(pool, requete, PASSAGES_DEMANDES, profil, date), plancherPour(nomDuModele())),
    consulterSolde(pool),
    consulterProfil(pool),
    consulterOrganigramme(pool), // chapitre 12, leçon 2
    interrogerSoldes(pool, llmDeProduction()), // chapitre 12, leçon 3 ; leçon 8 : avec le repli
    calculerIndemniteKm(),
    consulterCalendrier(pool), // leçon 5
    ouvrirTicket(pool),
  ];
}

export function assemblerRhea(outils: Agent["outils"], options: OptionsRhea): Agent {
  // Le LLM sans outils, pour condenser une question de suite (chapitre 9) ; leçon 5 : celui des étapes de la recherche
  const llmSimple = llmDeRecherche();
  // Leçon 8 : le LLM de .env derrière son disjoncteur, avec son repli. Le modèle de la trace (et du coût) est celui qui
  // répond vraiment : le repli, s'il a pris le relais
  const { llm, modele } = llmAgentDeProduction();
  return {
    llm,
    get modele() {
      return modele();
    },
    outils,
    systeme: options.systeme,
    toursMax: options.toursMax,
    recherche: options.recherche ?? "secours",
    condenser: (question, historique) => condenser(question, historique, llmSimple),
    confirmer: options.confirmer,
    journaliser: options.journaliser,
    // Leçon 4 : avec VERIFICATION=oui, chaque réponse vérifiée contre ses sources avant d'être rendue
    ...(config.VERIFICATION && { verifier: (question: string, reponse: string, preuves: { id: string; texte: string }[]) => verifierReponse(llmSimple, question, reponse, preuves) }),
    // Chapitre 12, leçon 2 : avec un salarié connecté, sa fiche de l'organigramme d'office (son manager, sa chaîne)
    appelsDOffice: options.matricule ? [{ id: "organigramme-d-office", nom: "consulter_organigramme", arguments: { personne: null } }] : [],
  };
}
