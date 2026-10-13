// La boucle de l'agent. On envoie au LLM la question et la liste des outils ; tant qu'il demande des appels, notre code
// les exécute et lui renvoie les résultats ; quand il répond sans rien demander, c'est la réponse. Chaque étape est
// rendue au fil de l'eau (un générateur), pour que la ligne de commande ou le serveur l'affichent
import { z } from "zod";
import { finDuMessage } from "../generation/prompt.ts";
import type { Usage } from "../llm.ts";
import type { AppelOutil, LlmAgent, Message } from "./llm-agent.ts";
import type { Contexte, Outil, ResultatOutil } from "./outil.ts";

// Un tour : un appel au LLM. Au-delà de TOURS_MAX, la boucle s'arrête : un agent qui tourne en rond coûte sans rien rendre
export const TOURS_MAX = 5;

export type Agent = { llm: LlmAgent; outils: Outil[]; systeme: string; toursMax?: number };

export type Etape =
  | { type: "appel"; tour: number; appel: AppelOutil }
  // detail : la cause d'un échec de l'outil, pour le terminal ; le LLM ne reçoit qu'un message général
  | { type: "resultat"; tour: number; appel: AppelOutil; resultat: ResultatOutil; erreur: boolean; detail?: string; duree: number }
  | { type: "reponse"; tour: number; texte: string; usage: Usage }
  | { type: "limite"; tour: number; usage: Usage };

type Execution = { resultat: ResultatOutil; erreur: boolean; detail?: string };

// Exécuter une demande d'appel. L'outil doit exister et les arguments passer la validation zod : le LLM écrit ces
// arguments, rien ne garantit qu'ils soient justes. Sinon, il reçoit l'erreur en résultat, et peut corriger son appel
export async function executer(appel: AppelOutil, outils: Outil[], contexte: Contexte): Promise<Execution> {
  const outil = outils.find((o) => o.nom === appel.nom);
  if (!outil) {
    return { resultat: { texte: `Outil inconnu : ${appel.nom}. Outils disponibles : ${outils.map((o) => o.nom).join(", ")}` }, erreur: true };
  }
  const lus = outil.parametres.safeParse(appel.arguments);
  if (!lus.success) return { resultat: { texte: `Arguments refusés :\n${z.prettifyError(lus.error)}` }, erreur: true };
  try {
    return { resultat: await outil.executer(lus.data, contexte), erreur: false };
  } catch (erreur) {
    // Le détail (requête SQL, chemin de fichier…) ne part pas au LLM, qui pourrait le répéter au salarié
    const texte = "L'outil a échoué. Répondez sans lui, ou proposez d'ouvrir un ticket dans l'espace RH.";
    return { resultat: { texte }, erreur: true, detail: (erreur as Error).message };
  }
}

const ajouter = (total: Usage, usage: Usage) => {
  total.entree += usage.entree;
  total.enCache += usage.enCache;
  total.sortie += usage.sortie;
};

export async function* agir(question: string, agent: Agent, contexte: Contexte): AsyncGenerator<Etape> {
  // Le premier message : la date du jour (certaines règles changent), puis la question, comme au chapitre 7
  const messages: Message[] = [{ role: "utilisateur", texte: finDuMessage(question, contexte.date) }];
  const usage: Usage = { entree: 0, enCache: 0, sortie: 0 }; // le total de la conversation
  const toursMax = agent.toursMax ?? TOURS_MAX;
  for (let tour = 1; tour <= toursMax; tour++) {
    // 1. Le LLM lit toute la conversation : la question, ses demandes précédentes et leurs résultats
    const reponse = await agent.llm(agent.systeme, messages, agent.outils);
    ajouter(usage, reponse.usage);
    messages.push({ role: "assistant", texte: reponse.texte, appels: reponse.appels, brut: reponse.brut });
    // 2. Aucune demande d'appel : il a répondu
    if (reponse.appels.length === 0) {
      yield { type: "reponse", tour, texte: reponse.texte, usage };
      return;
    }
    // 3. Sinon, chaque appel demandé est exécuté (un LLM peut en demander plusieurs à la fois), et son résultat ajouté
    for (const appel of reponse.appels) {
      yield { type: "appel", tour, appel };
      const debut = performance.now();
      const { resultat, erreur, detail } = await executer(appel, agent.outils, contexte);
      yield { type: "resultat", tour, appel, resultat, erreur, detail, duree: performance.now() - debut };
      messages.push({ role: "outil", id: appel.id, nom: appel.nom, texte: resultat.texte, passages: resultat.passages, erreur });
    }
  }
  yield { type: "limite", tour: toursMax, usage };
}
