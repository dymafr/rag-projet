// Les traces de la recherche : pour chaque question du jeu, les candidats que la recherche a rendus, dans l'ordre, avec
// leur score. On les enregistre une fois, puis on les analyse autant qu'on veut sans relancer la recherche, comme on
// analyserait les traces de Rhéa en production
import { readFile } from "node:fs/promises";
import { z } from "zod";

export const FichierDeTraces = z.object({
  date: z.iso.date(), // le jour de l'enregistrement
  embeddings: z.string(),
  recherche: z.string(), // les réglages de la recherche, en clair : « vectorielle », puis ceux des leçons suivantes
  profondeur: z.number(), // le nombre de candidats gardés par question, au-delà de k
  traces: z.array(
    z.object({
      id: z.string(),
      question: z.string(),
      autonome: z.string().optional(), // une question de suite, condensée avec son historique (leçon 8)
      candidats: z.array(z.object({ id: z.string(), score: z.number() })),
    }),
  ),
});
export type FichierDeTraces = z.infer<typeof FichierDeTraces>;

export async function lireTraces(fichier: string): Promise<FichierDeTraces> {
  const resultat = FichierDeTraces.safeParse(JSON.parse(await readFile(fichier, "utf8")));
  if (!resultat.success) throw new Error(`${fichier} invalide :\n${z.prettifyError(resultat.error)}`);
  return resultat.data;
}
