// Comparer des systèmes sur le jeu d'évaluation (chapitre 11, leçon 4) : la latence par centiles, et le coût de chaque
// question à partir des tokens et des appels de recherche, aux tarifs notés dans eval/tarifs.json
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Usage } from "../llm.ts";

// Le centile p (de 0 à 100) d'une liste de valeurs, par la méthode du rang le plus proche : la valeur sous laquelle se
// trouvent p % des mesures. Le 50e est la médiane ; le 95e, le temps que dépassent 5 % des questions
export function centile(valeurs: number[], p: number): number {
  if (valeurs.length === 0) return 0;
  const triees = [...valeurs].sort((a, b) => a - b);
  const rang = Math.max(1, Math.ceil((p / 100) * triees.length));
  return triees[rang - 1];
}

// Les tarifs d'un jour donné, en dollars : par million de tokens pour chaque modèle (« fournisseur modèle », comme le
// champ llm des traces), et pour 1 000 appels de file_search. Un modèle local n'y figure pas : il ne coûte rien par token
export const Tarifs = z.object({
  date: z.iso.date(),
  source: z.url(),
  // ecritureCache : le prix d'un token d'entrée écrit dans le cache, s'il est facturé à part (plus cher que l'entrée)
  modeles: z.record(z.string(), z.object({ entree: z.number(), enCache: z.number(), ecritureCache: z.number().optional(), sortie: z.number() })),
  fileSearchPour1000: z.number(),
});
export type Tarifs = z.infer<typeof Tarifs>;

export async function lireTarifs(fichier = "eval/tarifs.json"): Promise<Tarifs> {
  const resultat = Tarifs.safeParse(JSON.parse(await readFile(fichier, "utf8")));
  if (!resultat.success) throw new Error(`${fichier} invalide :\n${z.prettifyError(resultat.error)}`);
  return resultat.data;
}

// Le coût d'une question, en fourchette : les tokens d'entrée relus dans le cache coûtent moins cher que les autres, ceux
// écrits dans le cache plus cher. Si la trace dit combien ont été écrits, le coût est exact (min = max) ; sinon (une
// trace plus ancienne, ou un fournisseur qui ne le dit pas), il va d'aucune écriture à toute l'entrée non relue écrite.
// null : un modèle sans tarif (un modèle local)
export function cout(usage: Usage, recherches: number, modele: string, tarifs: Tarifs): { min: number; max: number } | null {
  const t = tarifs.modeles[modele];
  if (!t) return null;
  const nonRelus = usage.entree - usage.enCache;
  const base = (nonRelus * t.entree + usage.enCache * t.enCache + usage.sortie * t.sortie) / 1_000_000 + (recherches * tarifs.fileSearchPour1000) / 1000;
  const surcout = ((t.ecritureCache ?? t.entree) - t.entree) / 1_000_000; // par token écrit, en plus du prix d'entrée
  if (usage.ecritCache !== undefined) return { min: base + usage.ecritCache * surcout, max: base + usage.ecritCache * surcout };
  return { min: base, max: base + nonRelus * surcout };
}
