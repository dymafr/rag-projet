// Demander au LLM un objet JSON validé par un schéma zod, comme le juge du chapitre 8 : un essai, puis un second qui
// rappelle le format. null après deux réponses illisibles : l'appelant continue alors sans l'aide du LLM. Une erreur du
// LLM lui-même (Ollama arrêté, clé refusée) n'est pas rattrapée : elle arrête la recherche, comme elle arrêterait la réponse
import type { z } from "zod";
import { lireJson } from "../eval/juge.ts";
import type { Llm } from "../llm.ts";

export async function demanderJson<T>(llm: Llm, consigne: string, donnees: string, schema: z.ZodType<T>, format: string): Promise<T | null> {
  let rappel = "";
  for (let essai = 1; essai <= 2; essai++) {
    const { texte } = await llm(consigne, donnees + rappel);
    const lu = schema.safeParse(lireJson(texte));
    if (lu.success) return lu.data;
    rappel = `\n\nAttention : une première réponse était illisible. ${format}`;
  }
  return null;
}
