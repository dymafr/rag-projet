// Les passages qui serviront à répondre, parmi les textes en vigueur ce jour-là et ouverts à tous les salariés. Au
// chapitre 6, la recherche vectorielle seule ; le chapitre 9 ajoute d'autres étapes, chacune mesurée sur le jeu
// d'évaluation avant d'entrer dans les réglages de Rhéa (reglages.ts)
import { nomDuModele, vectoriser } from "../embeddings/fournisseurs.ts";
import type { Base } from "../stockage/base.ts";
import { lireIndexation } from "../stockage/schema.ts";
import { chercherHybride } from "./hybride.ts";
import { chercherPleinTexte } from "./plein-texte.ts";
import { RECHERCHE, type Reglages } from "./reglages.ts";
import { chercher, similarites, type Filtres, type Resultat } from "./vectorielle.ts";

// La date du jour, à l'heure locale (sv-SE écrit AAAA-MM-JJ)
export const aujourdhui = () => new Date().toLocaleDateString("sv-SE");

// Une recherche, pour une requête : celle du mode choisi
async function chercherUneFois(base: Base, requete: string, k: number, filtres: Filtres, reglages: Reglages): Promise<Resultat[]> {
  if (reglages.mode === "plein-texte") return chercherPleinTexte(base, requete, k, filtres);
  const [vecteur] = await vectoriser([requete], "requete");
  if (reglages.mode === "hybride") return chercherHybride(base, requete, vecteur, k, filtres, reglages);
  return chercher(base, vecteur, k, filtres);
}

export async function trouverPassages(base: Base, question: string, k: number, date = aujourdhui(), reglages: Reglages = RECHERCHE): Promise<Resultat[]> {
  const indexation = await lireIndexation(base);
  if (indexation && indexation.modele !== nomDuModele()) {
    throw new Error(`La base a été indexée avec ${indexation.modele}, le projet est réglé sur ${nomDuModele()} : relancez npm run indexer -- --reconstruire`);
  }
  // 1. Les filtres : acces, en attendant le chapitre 13, qui filtrera selon le rôle de chaque salarié (Rhéa ne lit ni les
  // documents réservés aux managers ni les tickets) ; la date du jour
  const filtres: Filtres = { enVigueurLe: date, acces: ["tous"] };
  // 2. La recherche. Son score doit être la similarité cosinus avec la question : c'est elle que compare le seuil
  // d'abstention du chapitre 7. Le plein texte donne un score BM25, sans maximum : on calcule la similarité des passages
  // qu'il a trouvés
  let resultats = await chercherUneFois(base, question, k, filtres, reglages);
  if (reglages.mode === "plein-texte") resultats = await avecSimilarites(base, question, resultats);
  return resultats;
}

// Les mêmes passages, avec pour score leur similarité cosinus avec la question
async function avecSimilarites(base: Base, question: string, resultats: Resultat[]): Promise<Resultat[]> {
  const [vecteur] = await vectoriser([question], "requete");
  const scores = new Map((await similarites(base, vecteur, resultats.map((r) => r.id))).map((r) => [r.id, r.score]));
  return resultats.map((r) => ({ ...r, score: scores.get(r.id)! }));
}
