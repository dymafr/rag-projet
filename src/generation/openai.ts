// Répondre avec l'API Responses d'OpenAI. Ollama comprend la même API, sous /v1 : le même code sert aux deux,
// seul le client change (new OpenAI() ou le client ollama de src/ollama.ts)
import type OpenAI from "openai";
import type { Generation } from "./generateur.ts";
import type { PromptAugmente } from "./prompt.ts";

// Assez pour quelques phrases. Un modèle qui raisonne compte ses tokens de réflexion dans cette limite, et peut l'épuiser
// avant d'écrire : la réponse revient alors coupée (incomplete). Il faut alors augmenter la limite
const MAX_TOKENS = 4096;

// Des réglages pour le modèle local. Une température de 0 fait choisir à chaque pas le token le plus probable : la réponse
// change très peu d'une exécution à l'autre. Sans réflexion, un modèle qui sait réfléchir répond tout de suite.
// Une limite de tokens plus basse laisse de la place au prompt dans la petite fenêtre de contexte d'Ollama.
// Un modèle OpenAI qui raisonne refuserait la température : ces réglages ne partent qu'à Ollama
export type Reglages = { temperature?: number; reasoning?: { effort: "none" }; max_output_tokens?: number };

const usageDe = (usage?: OpenAI.Responses.ResponseUsage) => ({
  entree: usage?.input_tokens ?? 0,
  enCache: usage?.input_tokens_details?.cached_tokens ?? 0,
  sortie: usage?.output_tokens ?? 0,
});

export async function repondreAvecResponses(client: OpenAI, modele: string, prompt: PromptAugmente, reglages: Reglages = {}): Promise<Generation> {
  const reponse = await client.responses.create({
    model: modele,
    instructions: prompt.systeme, // le prompt système
    input: prompt.utilisateur, // le message : les passages, la date du jour et la question
    max_output_tokens: MAX_TOKENS,
    store: false, // sinon OpenAI garde la réponse sur ses serveurs ; Rhéa n'en a pas besoin
    ...reglages,
  });
  // Une réponse coupée (limite de tokens atteinte, filtre de contenu) ne doit pas passer pour une réponse complète.
  // Ollama répond « completed » même quand la limite a coupé la réponse : on compare aussi les tokens produits à la limite
  if (reponse.status !== "completed") {
    throw new Error(`Réponse ${reponse.status ?? "inconnue"} : ${reponse.incomplete_details?.reason ?? reponse.error?.message ?? "raison inconnue"}`);
  }
  if ((reponse.usage?.output_tokens ?? 0) >= (reglages.max_output_tokens ?? MAX_TOKENS)) throw new Error("Réponse coupée par la limite de tokens");
  // Un refus de sécurité du modèle n'est pas une réponse de Rhéa : on le signale tel quel
  const refus = reponse.output.flatMap((sortie) => (sortie.type === "message" ? sortie.content : [])).find((c) => c.type === "refusal");
  if (refus) throw new Error(`Refus du modèle : ${refus.refusal}`);
  return {
    texte: reponse.output_text, // le texte de la réponse, rassemblé par le SDK
    usage: usageDe(reponse.usage),
  };
}
