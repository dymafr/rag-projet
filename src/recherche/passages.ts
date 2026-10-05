// Les passages qui serviront à répondre : la question vectorisée par le modèle qui a indexé la base, puis les k chunks
// les plus proches parmi les textes en vigueur ce jour-là et ouverts à tous les salariés
import { nomDuModele, vectoriser } from "../embeddings/fournisseurs.ts";
import type { Base } from "../stockage/base.ts";
import { lireIndexation } from "../stockage/schema.ts";
import { chercher, type Resultat } from "./vectorielle.ts";

// La date du jour, à l'heure locale (sv-SE écrit AAAA-MM-JJ)
export const aujourdhui = () => new Date().toLocaleDateString("sv-SE");

export async function trouverPassages(base: Base, question: string, k: number, date = aujourdhui()): Promise<Resultat[]> {
  const indexation = await lireIndexation(base);
  if (indexation && indexation.modele !== nomDuModele()) {
    throw new Error(`La base a été indexée avec ${indexation.modele}, le projet est réglé sur ${nomDuModele()} : relancez npm run indexer -- --reconstruire`);
  }
  const [vecteur] = await vectoriser([question], "requete");
  // acces : en attendant le chapitre 13, qui filtrera selon le rôle de chaque salarié, Rhéa ne lit
  // ni les documents réservés aux managers ni les tickets, réservés au service RH
  return chercher(base, vecteur, k, { enVigueurLe: date, acces: ["tous"] });
}
