// L'agent avec l'API Responses d'OpenAI, que comprend aussi Ollama (sous /v1) : le même code sert aux deux, seul le
// client change. Un outil part en type function ; une demande d'appel revient en élément function_call, et son
// résultat repart en élément function_call_output, relié à la demande par call_id
import type OpenAI from "openai";
import { usageDe, type Reglages } from "../generation/openai.ts";
import type { LlmAgent, Message } from "./llm-agent.ts";
import { schemaJson, type Outil } from "./outil.ts";

type Element = OpenAI.Responses.ResponseInputItem;
export type ReglagesAgent = Reglages & { include?: OpenAI.Responses.ResponseIncludable[] };

const MAX_TOKENS = 4096; // voir generation/openai.ts : la réflexion d'un modèle qui raisonne compte dans cette limite

// strict: true : OpenAI garantit des arguments conformes au schéma (Ollama lit ce champ et l'ignore).
// Nos propres contrôles restent nécessaires : la boucle valide toujours les arguments avec zod
export const outilResponses = (outil: Outil): OpenAI.Responses.FunctionTool => ({
  type: "function",
  name: outil.nom,
  description: outil.description,
  parameters: schemaJson(outil),
  strict: true,
});

// La conversation commune, traduite en éléments de l'API Responses
export function versResponses(messages: Message[]): Element[] {
  return messages.flatMap((m): Element[] => {
    if (m.role === "utilisateur") return [{ role: "user", content: m.texte }];
    if (m.role === "outil") return [{ type: "function_call_output", call_id: m.id, output: m.texte }];
    if (m.brut) return m.brut as Element[]; // la réponse de l'API, renvoyée telle quelle
    return [
      ...(m.texte ? [{ role: "assistant" as const, content: m.texte }] : []),
      ...m.appels.map((a) => ({ type: "function_call" as const, call_id: a.id, name: a.nom, arguments: JSON.stringify(a.arguments) })),
    ];
  });
}

// Les arguments arrivent en texte JSON. Illisibles, ils restent du texte : la validation de la boucle les refusera
function lireArguments(texte: string): unknown {
  try {
    return JSON.parse(texte);
  } catch {
    return texte;
  }
}

export function agentResponses(client: OpenAI, modele: string, reglages: ReglagesAgent = {}): LlmAgent {
  return async (systeme, messages, outils, options = {}) => {
    const reponse = await client.responses.create({
      model: modele,
      instructions: systeme,
      input: versResponses(messages),
      tools: outils.map(outilResponses),
      // Dernier tour : OpenAI n'appelle plus d'outil. Ollama ignore ce réglage : la consigne de la boucle le demande, et un appel rendu quand même n'est pas exécuté
      ...(options.sansOutil && { tool_choice: "none" as const }),
      max_output_tokens: MAX_TOKENS,
      store: false, // OpenAI ne garde pas la conversation : on la renvoie entière à chaque tour
      ...reglages,
    });
    // Comme pour les réponses de Rhéa : une réponse coupée ne doit pas passer pour une réponse complète
    if (reponse.status !== "completed") {
      throw new Error(`Réponse ${reponse.status ?? "inconnue"} : ${reponse.incomplete_details?.reason ?? reponse.error?.message ?? "raison inconnue"}`);
    }
    if ((reponse.usage?.output_tokens ?? 0) >= (reglages.max_output_tokens ?? MAX_TOKENS)) throw new Error("Réponse coupée par la limite de tokens");
    const appels = reponse.output.flatMap((e) => (e.type === "function_call" ? [{ id: e.call_id, nom: e.name, arguments: lireArguments(e.arguments) }] : []));
    return { texte: reponse.output_text, appels, usage: usageDe(reponse.usage), brut: reponse.output };
  };
}
