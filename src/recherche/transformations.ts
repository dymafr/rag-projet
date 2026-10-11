// Transformer la question avant de chercher : le LLM la réécrit, en propose plusieurs formulations, imagine un passage
// qui y répondrait (HyDE) ou la découpe en sous-questions. Chaque transformation coûte un appel au LLM avant la recherche
import { z } from "zod";
import type { Llm } from "../llm.ts";
import { demanderJson } from "./llm-json.ts";

export const TRANSFORMATIONS = ["reecrire", "multiplier", "hyde", "decomposer"] as const;
export type Transformation = (typeof TRANSFORMATIONS)[number];

const FORMAT = `Réponds uniquement avec un objet JSON : {"requetes": ["…"]}`;
const CONTEXTE = "Tu aides un moteur de recherche dans la documentation RH de Kalyo, une entreprise française. Ne réponds jamais à la question.";

const CONSIGNES: Record<Transformation, string> = {
  // 1. Une seule requête, claire et complète, avec les mots qu'emploierait un document RH
  reecrire: `${CONTEXTE}
Réécris la question du salarié en une requête de recherche claire, en français, avec les mots qu'emploierait un document RH : termes complets, sans abréviation ni faute.
${FORMAT}`,
  // 2. Trois formulations différentes : chacune est cherchée, puis les résultats sont fusionnés
  multiplier: `${CONTEXTE}
Propose trois formulations différentes de la question du salarié, en français, qui pourraient chacune retrouver le passage qui y répond : change les mots, garde le sens.
${FORMAT}`,
  // 3. HyDE : un passage imaginaire, cherché à la place de la question. Il ressemble plus aux documents qu'une question
  hyde: `${CONTEXTE}
Écris un court passage, trois phrases au plus, tel qu'il pourrait figurer dans une politique RH et qui répondrait à la question. Si tu ne connais pas les chiffres, invente-les : ce passage sert seulement à la recherche, personne ne le lira.
${FORMAT}`,
  // 4. Une question qui en contient plusieurs devient plusieurs sous-questions, cherchées chacune
  decomposer: `${CONTEXTE}
Si la question du salarié contient plusieurs questions, découpe-la en sous-questions qui se comprennent seules, en français. Sinon, rends-la telle quelle, en une seule requête.
${FORMAT}`,
};

const Requetes = z.object({ requetes: z.array(z.string().trim().min(1)).min(1).max(5) });

// Les requêtes à chercher. Si le LLM ne rend rien de lisible, on cherche la question telle quelle. Le passage de HyDE
// arrive souvent phrase par phrase, une phrase par élément : on recolle les phrases, pour chercher un seul passage
export async function transformer(question: string, transformation: Transformation, llm: Llm): Promise<string[]> {
  const lu = await demanderJson(llm, CONSIGNES[transformation], `<question>\n${question}\n</question>`, Requetes, FORMAT);
  if (!lu) return [question];
  return transformation === "hyde" ? [lu.requetes.join(" ")] : lu.requetes;
}
