// Les passages qui serviront à répondre, parmi les textes en vigueur ce jour-là et ouverts à tous les salariés. Au
// chapitre 6, la recherche vectorielle seule ; le chapitre 9 ajoute d'autres étapes, chacune mesurée sur le jeu
// d'évaluation avant d'entrer dans les réglages de Rhéa (reglages.ts)
import { config } from "../config.ts";
import { nomDuModele, vectoriser } from "../embeddings/fournisseurs.ts";
import { creerLlm, type Llm } from "../llm.ts";
import type { Base } from "../stockage/base.ts";
import { lireIndexation } from "../stockage/schema.ts";
import { fusionner } from "./fusion.ts";
import { chercherHybride } from "./hybride.ts";
import { chercherPleinTexte } from "./plein-texte.ts";
import { RECHERCHE, type Reglages } from "./reglages.ts";
import { crossEncoder, parLeLlm, reclasser, type Reclasseur } from "./rerank.ts";
import { transformer } from "./transformations.ts";
import { chercher, similarites, type Filtres, type Resultat } from "./vectorielle.ts";
import { enrichir } from "./vocabulaire.ts";

// La date du jour, à l'heure locale (sv-SE écrit AAAA-MM-JJ)
export const aujourdhui = () => new Date().toLocaleDateString("sv-SE");

// Ce que certains réglages demandent : le LLM et le cross-encoder. Par défaut, ceux de .env, créés au premier besoin (le
// cross-encoder ne se charge qu'au premier reclassement) ; un appelant peut passer les siens, ou n'en passer aucun
export type Outils = { llm?: Llm; crossEncoder?: Reclasseur };
let outilsDeEnv: Required<Outils> | undefined;
export const outilsParDefaut = (): Required<Outils> => (outilsDeEnv ??= { llm: creerLlm(), crossEncoder: crossEncoder(config.RERANK_MODEL) });

// Une recherche, pour une requête : celle du mode choisi. Le plein texte cherche des mots-clés : la requête, enrichie du
// vocabulaire de Kalyo si le réglage vocabulaire est actif (leçon 4)
async function chercherUneFois(base: Base, requete: string, k: number, filtres: Filtres, reglages: Reglages): Promise<Resultat[]> {
  const motsCles = reglages.vocabulaire ? enrichir(requete) : requete;
  if (reglages.mode === "plein-texte") return chercherPleinTexte(base, motsCles, k, filtres);
  const [vecteur] = await vectoriser([requete], "requete");
  if (reglages.mode === "hybride") return chercherHybride(base, motsCles, vecteur, k, filtres, reglages);
  return chercher(base, vecteur, k, filtres);
}

// k : les passages à rendre. profondeur : pour les traces de l'évaluation, combien de passages du classement rendre en
// tout, au-delà de k ; les étapes qui choisissent parmi des candidats n'en reçoivent pas plus pour autant
export async function trouverPassages(
  base: Base,
  question: string,
  k: number,
  date = aujourdhui(),
  reglages: Reglages = RECHERCHE,
  outils: Outils = outilsParDefaut(),
  profondeur = k,
): Promise<Resultat[]> {
  const indexation = await lireIndexation(base);
  if (indexation && indexation.modele !== nomDuModele()) {
    throw new Error(`La base a été indexée avec ${indexation.modele}, le projet est réglé sur ${nomDuModele()} : relancez npm run indexer -- --reconstruire`);
  }
  const llm = (): Llm => {
    if (!outils.llm) throw new Error("Ces réglages demandent un LLM : passez-le dans les outils");
    return outils.llm;
  };
  // 1. Les filtres : acces, en attendant le chapitre 13, qui filtrera selon le rôle de chaque salarié (Rhéa ne lit ni les
  // documents réservés aux managers ni les tickets) ; la date du jour
  const filtres: Filtres = { enVigueurLe: date, acces: ["tous"] };
  // 2. Les requêtes : la question, ou ce que le LLM en a fait. Plusieurs formulations ou sous-questions : la question
  // d'origine est cherchée aussi (une seule fois, si le LLM la rend telle quelle)
  let requetes = reglages.transformation ? await transformer(question, reglages.transformation, llm()) : [question];
  if (reglages.transformation === "multiplier" || reglages.transformation === "decomposer") requetes = [...new Set([question, ...requetes])];
  // 3. Une recherche par requête. Quand une étape choisira ensuite parmi des candidats (la fusion de plusieurs requêtes,
  // le reclassement), chaque recherche en propose reglages.candidats ; sinon, les k premiers suffisent (ou la profondeur
  // demandée par les traces)
  const n = requetes.length > 1 || reglages.reclassement ? Math.max(k, reglages.candidats) : Math.max(k, profondeur);
  const listes: Resultat[][] = [];
  for (const requete of requetes) listes.push(await chercherUneFois(base, requete, n, filtres, reglages));
  let resultats = listes[0];
  if (listes.length > 1) {
    const parId = new Map(listes.flat().map((r) => [r.id, r]));
    resultats = fusionner(listes.map((l) => l.map((r) => r.id))).slice(0, n).map((id) => parId.get(id)!);
  }
  // 4. Le score de chaque passage doit être sa similarité cosinus avec la question : c'est elle que compare le seuil
  // d'abstention du chapitre 7. Le plein texte donne un score BM25, sans maximum ; après une transformation, les scores
  // viennent des requêtes du LLM : on les recalcule avec la question
  if (reglages.mode === "plein-texte" || reglages.transformation) resultats = await avecSimilarites(base, question, resultats);
  // 5. Le choix des k passages parmi les candidats : le reclasseur lit la question et chaque candidat ; sinon, les
  // premiers. Le classement continue au-delà de k quand les traces demandent une profondeur
  const rendre = Math.max(k, profondeur);
  if (reglages.reclassement) {
    const reclasseur = reglages.reclasseur === "llm" ? parLeLlm(llm()) : outils.crossEncoder;
    if (!reclasseur) throw new Error("Ces réglages demandent un cross-encoder : passez-le dans les outils");
    return reclasser(question, resultats, reclasseur, rendre);
  }
  return resultats.slice(0, rendre);
}

// Les mêmes passages, avec pour score leur similarité cosinus avec la question
async function avecSimilarites(base: Base, question: string, resultats: Resultat[]): Promise<Resultat[]> {
  const [vecteur] = await vectoriser([question], "requete");
  const scores = new Map((await similarites(base, vecteur, resultats.map((r) => r.id))).map((r) => [r.id, r.score]));
  return resultats.map((r) => ({ ...r, score: scores.get(r.id)! }));
}
