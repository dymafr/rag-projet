// La recherche hybride : la recherche vectorielle et la recherche plein texte, lancées chacune avec ses candidats, puis
// fusionnées par leurs rangs (fusion.ts). Le score de chaque passage reste sa similarité cosinus avec la question : c'est
// lui que compare le seuil d'abstention du chapitre 7. La fusion ne change que l'ordre
import type { Base } from "../stockage/base.ts";
import { fusionner } from "./fusion.ts";
import { chercherPleinTexte } from "./plein-texte.ts";
import { chercher, similarites, type Filtres, type Resultat } from "./vectorielle.ts";

// motsCles : ce que cherche le plein texte (la question, ou la question enrichie de ses synonymes). candidats : combien
// de passages chaque recherche propose à la fusion. poids : celui de la recherche vectorielle, puis celui de la recherche
// plein texte
export async function chercherHybride(
  base: Base,
  motsCles: string,
  vecteur: number[],
  k: number,
  filtres: Filtres = {},
  options: { candidats?: number; poids?: [number, number] } = {},
): Promise<Resultat[]> {
  const { candidats = 50, poids = [1, 1] } = options;
  const vectoriels = await chercher(base, vecteur, candidats, filtres);
  const lexicaux = await chercherPleinTexte(base, motsCles, candidats, filtres);
  const ordre = fusionner([vectoriels.map((r) => r.id), lexicaux.map((r) => r.id)], poids).slice(0, k);
  // Un passage trouvé par le seul plein texte n'a pas encore de similarité cosinus : on la demande à la base
  const parId = new Map(vectoriels.map((r) => [r.id, r]));
  const manquants = ordre.filter((id) => !parId.has(id));
  for (const r of await similarites(base, vecteur, manquants)) parId.set(r.id, r);
  return ordre.map((id) => parId.get(id)!);
}
