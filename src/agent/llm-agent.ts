// Le LLM de l'agent : il reçoit la conversation et la liste des outils, et rend soit une réponse, soit des demandes
// d'appel d'outil. La conversation suit un format commun ; chaque fournisseur a son adaptateur, qui la traduit pour son API
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { config } from "../config.ts";
import { conseilSiErreurOllama, LOCAL } from "../generation/generateur.ts";
import type { Usage } from "../llm.ts";
import { ollama } from "../ollama.ts";
import type { Resultat } from "../recherche/vectorielle.ts";
import { agentClaude } from "./claude.ts";
import type { Outil } from "./outil.ts";
import { agentResponses } from "./responses.ts";

// Une demande d'appel : l'identifiant donné par l'API relie l'appel à son résultat
export type AppelOutil = { id: string; nom: string; arguments: unknown };

export type Message =
  | { role: "utilisateur"; texte: string }
  // brut : la réponse telle que l'API l'a rendue. On la lui renvoie à l'identique au tour suivant : elle peut contenir
  // des éléments qu'elle exige de retrouver, comme la réflexion du modèle
  | { role: "assistant"; texte: string; appels: AppelOutil[]; brut?: unknown[] }
  | { role: "outil"; id: string; nom: string; texte: string; passages?: Resultat[]; erreur: boolean };

export type ReponseAgent = { texte: string; appels: AppelOutil[]; usage: Usage; brut: unknown[] };
// sansOutil : le dernier tour (chapitre 10, leçon 4). Le LLM doit répondre avec ce qu'il a, sans demander d'appel
export type OptionsAppel = { sansOutil?: boolean };
export type LlmAgent = (systeme: string, messages: Message[], outils: Outil[], options?: OptionsAppel) => Promise<ReponseAgent>;

// Le fournisseur de .env (chapitre 14 : ou un autre, pour le repli). OpenAI et Ollama passent par l'API Responses ; avec
// OpenAI, la réflexion d'un modèle qui raisonne revient chiffrée, pour qu'on puisse la renvoyer sans que la conversation
// soit gardée chez OpenAI (store: false)
export function creerLlmAgent(modele = config.LLM_MODEL, fournisseur = config.LLM_PROVIDER): LlmAgent {
  if (fournisseur === "openai") return agentResponses(new OpenAI(), modele, { include: ["reasoning.encrypted_content"] });
  if (fournisseur === "ollama") {
    const llm = agentResponses(ollama, modele, LOCAL);
    return (systeme, messages, outils, options) => llm(systeme, messages, outils, options).catch(conseilSiErreurOllama);
  }
  return agentClaude(new Anthropic(), modele);
}
