// Une conversation : « Combien de RTT ai-je par an ? », puis « Et à 80 % ? ». Seule, la seconde question ne dit pas de
// quoi elle parle : la recherche ne peut rien en faire. Le LLM la condense avec l'historique en une question autonome,
// que l'on cherche à sa place
import { z } from "zod";
import type { Llm } from "../llm.ts";
import { demanderJson } from "./llm-json.ts";

export type Echange = { question: string; reponse: string };

// Les derniers échanges suffisent : une suite renvoie presque toujours à la question d'avant. Garder tout l'historique
// allongerait le prompt à chaque tour
export const TOURS = 3;

const FORMAT = `Réponds uniquement avec un objet JSON : {"question": "la question autonome"}`;
const CONSIGNE = `Tu reformules la dernière question d'un salarié pour qu'elle se comprenne seule, sans l'historique de la conversation : remplace « et pour… », « il », « ça », « les » par ce qu'ils désignent dans les échanges précédents.
Garde la langue et le sens de la question. Ne réponds pas à la question. Si elle se comprend déjà seule, rends-la telle quelle.
${FORMAT}`;

const Condensee = z.object({ question: z.string().trim().min(1) });

export async function condenser(question: string, historique: Echange[], llm: Llm, tours = TOURS): Promise<string> {
  if (historique.length === 0) return question; // première question : rien à condenser, pas d'appel au LLM
  const echanges = historique
    .slice(-tours)
    .map((e) => `Salarié : ${e.question}\nRhéa : ${e.reponse}`)
    .join("\n\n");
  const lu = await demanderJson(llm, CONSIGNE, `<historique>\n${echanges}\n</historique>\n\n<question>\n${question}\n</question>`, Condensee, FORMAT);
  return lu?.question ?? question; // réponse illisible : on cherche la question telle quelle
}
