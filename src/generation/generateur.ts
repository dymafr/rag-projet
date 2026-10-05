// Le générateur choisi dans .env : il reçoit le prompt augmenté et rend la réponse de Rhéa, avec les tokens consommés.
// json : la réponse est demandée en JSON, au format de structure.ts
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { config } from "../config.ts";
import type { Usage } from "../llm.ts";
import { conseilOllama, ollama } from "../ollama.ts";
import { repondreAvecClaude } from "./claude.ts";
import { repondreAvecResponses, type Reglages } from "./openai.ts";
import type { PromptAugmente } from "./prompt.ts";
import type { DemandeJson } from "./structure.ts";

export type Citation = { numero: number; texteCite: string }; // le numéro du passage cité, et le texte qu'il en cite
export type Generation = { texte: string; usage: Usage; citations?: Citation[] }; // citations : avec Claude
export type Generateur = (prompt: PromptAugmente, json?: DemandeJson) => Promise<Generation>;

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
    return (prompt, json) => repondreAvecResponses(client, config.LLM_MODEL, prompt, {}, json);
  }
  if (config.LLM_PROVIDER === "ollama") {
    return (prompt, json) => repondreAvecResponses(ollama, config.LLM_MODEL, prompt, LOCAL, json).catch(conseilSiErreurOllama);
  }
  const client = new Anthropic(); // lit ANTHROPIC_API_KEY dans l'environnement
  return (prompt, json) => repondreAvecClaude(client, config.LLM_MODEL, prompt, json);
}
