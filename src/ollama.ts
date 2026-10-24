// Client pour Ollama : le serveur local expose une API compatible avec celle d'OpenAI, sous /v1
import OpenAI from "openai";
import { config } from "./config.ts";

export const ollama = new OpenAI({
  baseURL: `${config.OLLAMA_BASE_URL}/v1`,
  apiKey: "ollama", // Ollama ignore la clé, mais le SDK en exige une
});

// Un échec vient presque toujours d'un serveur arrêté ou d'un modèle pas encore téléchargé. Chapitre 14, leçon 8 : l'erreur
// garde son statut HTTP et sa cause, pour qu'une surcharge d'Ollama (503) se distingue d'un bogue (charge/disjoncteur.ts)
export function conseilOllama(erreur: Error): never {
  const conseil = new Error(`${erreur.message} (Ollama est-il lancé ? Le modèle est-il téléchargé avec ollama pull ?)`, { cause: erreur });
  throw Object.assign(conseil, { status: (erreur as { status?: number }).status });
}
