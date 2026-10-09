// Le générateur choisi dans .env : il reçoit le prompt augmenté et rend la réponse de Rhéa, avec les tokens consommés
import OpenAI from "openai";
import { config } from "../config.ts";
import type { Usage } from "../llm.ts";
import { conseilOllama, ollama } from "../ollama.ts";
import { repondreAvecResponses, type Reglages } from "./openai.ts";
import type { PromptAugmente } from "./prompt.ts";

export type Generation = { texte: string; usage: Usage };
export type Generateur = (prompt: PromptAugmente) => Promise<Generation>;

const LOCAL: Reglages = { temperature: 0, reasoning: { effort: "none" }, max_output_tokens: 1024 }; // voir openai.ts

// Le conseil d'Ollama (« Ollama est-il lancé ? ») ne vaut que pour une erreur de son API : serveur arrêté, modèle absent.
// Une réponse coupée ou refusée, que signale openai.ts, garde son propre message
function conseilSiErreurOllama(erreur: Error): never {
  if (erreur instanceof OpenAI.APIError) conseilOllama(erreur);
  throw erreur;
}

export function creerGenerateur(): Generateur {
  if (config.LLM_PROVIDER === "openai") {
    const client = new OpenAI(); // lit OPENAI_API_KEY dans l'environnement
    return (prompt) => repondreAvecResponses(client, config.LLM_MODEL, prompt);
  }
  if (config.LLM_PROVIDER === "ollama") {
    return (prompt) => repondreAvecResponses(ollama, config.LLM_MODEL, prompt, LOCAL).catch(conseilSiErreurOllama);
  }
  throw new Error("Claude arrive à la leçon suivante : d'ici là, réglez LLM_PROVIDER sur openai ou ollama");
}
