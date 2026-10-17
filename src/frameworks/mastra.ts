// L'agent du chapitre 10 confié à Mastra (chapitre 11) : Mastra fournit la boucle (appels d'outils, tours, arrêt), à la
// place de src/agent/boucle.ts ; on lui donne nos outils tels quels, le prompt de l'agent et le modèle de .env
import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import type { Contexte, Outil } from "../agent/outil.ts";
import { config } from "../config.ts";

// Un outil du chapitre 10 devient un outil Mastra : même nom, même description, même schéma zod. Le contexte (la date,
// le salarié connecté) reste fixé par notre code, jamais par le LLM
export const versMastra = (outil: Outil, contexte: Contexte) =>
  createTool({
    id: outil.nom,
    description: outil.description,
    inputSchema: outil.parametres,
    execute: async (args) => (await outil.executer(args, contexte)).texte,
  });

// Le modèle de .env : Ollama par son API compatible OpenAI, ou un fournisseur hébergé désigné par « fournisseur/modèle »
// (Mastra lit alors la clé dans l'environnement : OPENAI_API_KEY, ANTHROPIC_API_KEY). Pour Ollama, l'API Chat
// Completions : avec l'API Responses, Mastra renvoie au deuxième tour une référence à la réponse précédente, gardée chez
// OpenAI, qu'Ollama ne connaît pas
export const modeleMastra = () =>
  config.LLM_PROVIDER === "ollama"
    ? { providerId: "ollama", modelId: config.LLM_MODEL, url: `${config.OLLAMA_BASE_URL}/v1`, apiKey: "ollama", api: "chat" as const }
    : `${config.LLM_PROVIDER}/${config.LLM_MODEL}`;

// Les réglages à passer à chaque appel. Chaque fournisseur ne lit que sa clé de providerOptions : openaiCompatible pour
// un point d'accès compatible OpenAI comme Ollama (pas de réflexion, comme Rhéa en local), openai pour OpenAI (store:
// false, comme le reste de Rhéa : OpenAI ne garde pas les réponses). La température 0 ne part qu'au modèle local
export const reglagesMastra = () => ({
  ...(config.LLM_PROVIDER === "ollama" && { modelSettings: { temperature: 0 } }),
  providerOptions: { openaiCompatible: { reasoningEffort: "none" }, openai: { store: false } },
});

export function agentMastra(outils: Outil[], contexte: Contexte, instructions: string) {
  return new Agent({
    id: "rhea",
    name: "Rhéa",
    instructions,
    model: modeleMastra(),
    tools: Object.fromEntries(outils.map((o) => [o.nom, versMastra(o, contexte)])),
  });
}
