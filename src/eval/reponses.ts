// Les réponses de Rhéa enregistrées pour le jeu d'évaluation : pour chaque question, ce que la recherche a trouvé,
// ce qui a été envoyé au LLM et ce qu'il a répondu. Le juge et les métriques travaillent ensuite sur ce fichier,
// sans rappeler Rhéa : on peut juger, corriger un juge et rejuger les mêmes réponses autant de fois qu'il faut
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { BUDGET_PASSAGES, PASSAGES_DEMANDES } from "../generation/prompt.ts";

export const ReponseEnregistree = z.object({
  id: z.string(),
  question: z.string(),
  date: z.iso.date(), // la date du jour donnée à Rhéa
  trouves: z.array(z.object({ id: z.string(), score: z.number() })), // les passages de la recherche, dans l'ordre
  passages: z.array(z.object({ numero: z.number(), id: z.string(), texte: z.string() })), // ceux envoyés au LLM, numérotés
  texte: z.string(), // la réponse du LLM, vide s'il n'a pas été appelé
  sources: z.array(z.object({ numero: z.number(), source: z.string(), extraits: z.array(z.object({ texte: z.string(), trouvee: z.boolean() })) })),
  // avant-llm : Rhéa s'est abstenue sans appeler le LLM (score sous le seuil, ou aucun passage dans le budget) ;
  // sans-source : le LLM a répondu sans citer de passage vérifiable, et sa réponse a été remplacée
  abstention: z.enum(["avant-llm", "sans-source"]).nullable(),
  duree: z.number(), // en millisecondes
});
export type ReponseEnregistree = z.infer<typeof ReponseEnregistree>;

export const Enregistrement = z.object({
  date: z.iso.date(), // le jour de l'enregistrement
  llm: z.string(),
  embeddings: z.string(),
  prompt: z.string(), // la version du prompt système et son empreinte
  // Les réglages de Rhéa pendant l'enregistrement ; un enregistrement plus ancien, sans eux, a utilisé ceux par défaut
  k: z.number().default(PASSAGES_DEMANDES), // les passages demandés à la recherche
  budget: z.number().default(BUDGET_PASSAGES), // les tokens réservés aux passages dans le prompt
  reponses: z.array(ReponseEnregistree),
});
export type Enregistrement = z.infer<typeof Enregistrement>;

export async function lireReponses(fichier = "eval/reponses.json"): Promise<Enregistrement> {
  const resultat = Enregistrement.safeParse(JSON.parse(await readFile(fichier, "utf8")));
  if (!resultat.success) throw new Error(`${fichier} invalide :\n${z.prettifyError(resultat.error)}`);
  return resultat.data;
}

// L'empreinte d'une réponse : un verdict, humain ou du juge, ne vaut que pour le texte exact qu'il a jugé
export const empreinte = (texte: string) => createHash("sha256").update(texte).digest("hex").slice(0, 12);
