// Les passages qui serviront à répondre, parmi les textes en vigueur ce jour-là que le lecteur a le droit de lire
// (chapitre 13). Au chapitre 6, la recherche vectorielle seule ; le chapitre 9 ajoute d'autres étapes, chacune mesurée
// sur le jeu d'évaluation avant d'entrer dans les réglages de Rhéa (reglages.ts)
import { config } from "../config.ts";
import { nomDuModele, vectoriser } from "../embeddings/fournisseurs.ts";
import { creerLlm, type Llm } from "../llm.ts";
import type { Base } from "../stockage/base.ts";
import { lireIndexation } from "../stockage/schema.ts";
import { basePour, NIVEAUX, type Connexions, type Profil } from "./droits.ts";
import { mmr } from "./diversite.ts";
import { aDesIndices, extraireFiltres } from "./filtres-extraits.ts";
import { fusionner } from "./fusion.ts";
import { chercherHybride } from "./hybride.ts";
import { chercherPleinTexte } from "./plein-texte.ts";
import { RECHERCHE, type Reglages } from "./reglages.ts";
import { crossEncoder, parLeLlm, reclasser, type Reclasseur } from "./rerank.ts";
import { transformer } from "./transformations.ts";
import { chercher, similarites, vecteurs, type Filtres, type Resultat } from "./vectorielle.ts";
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

// k : les passages à rendre. profil : celui du lecteur, sans valeur par défaut, pour qu'aucun appel ne l'oublie.
// profondeur : pour les traces de l'évaluation, combien de passages du classement rendre en tout, au-delà de k ; les
// étapes qui choisissent parmi des candidats n'en reçoivent pas plus pour autant
export async function trouverPassages(
  pool: Connexions,
  question: string,
  k: number,
  profil: Profil,
  date = aujourdhui(),
  reglages: Reglages = RECHERCHE,
  outils: Outils = outilsParDefaut(),
  profondeur = k,
): Promise<Resultat[]> {
  if (reglages.reclassement && reglages.diversite !== null) throw new Error("Reclassement et diversité ne se combinent pas : choisissez l'un ou l'autre");
  const indexation = await lireIndexation(pool);
  if (indexation && indexation.modele !== nomDuModele()) {
    throw new Error(`La base a été indexée avec ${indexation.modele}, le projet est réglé sur ${nomDuModele()} : relancez npm run indexer -- --reconstruire`);
  }
  const llm = (): Llm => {
    if (!outils.llm) throw new Error("Ces réglages demandent un LLM : passez-le dans les outils");
    return outils.llm;
  };
  // 1. Les filtres : les niveaux d'accès du profil, et la date du jour, sauf si la question en précise une autre. Le LLM
  // n'est appelé que si la question contient un indice (une année, un mois, un type de document…). Toutes les requêtes
  // passent par une base restreinte au profil (droits.ts) : la sécurité par ligne double le filtre
  const base = basePour(pool, profil);
  const filtres: Filtres = { enVigueurLe: date, acces: NIVEAUX[profil] };
  const extraits = reglages.filtresExtraits && aDesIndices(question) ? await extraireFiltres(question, date, llm()) : {};
  // 2. Les requêtes : la question, ou ce que le LLM en a fait. Plusieurs formulations ou sous-questions : la question
  // d'origine est cherchée aussi (une seule fois, si le LLM la rend telle quelle)
  let requetes = reglages.transformation ? await transformer(question, reglages.transformation, llm()) : [question];
  if (reglages.transformation === "multiplier" || reglages.transformation === "decomposer") requetes = [...new Set([question, ...requetes])];
  // 3. Une recherche par requête. Quand une étape choisira ensuite parmi des candidats (la fusion de plusieurs requêtes,
  // le reclassement, MMR), chaque recherche en propose reglages.candidats ; sinon, les k premiers suffisent (ou la
  // profondeur demandée par les traces)
  const choix = requetes.length > 1 || reglages.reclassement || reglages.diversite !== null;
  const n = choix ? Math.max(k, reglages.candidats) : Math.max(k, profondeur);
  const chercherTout = async (f: Filtres) => {
    const listes: Resultat[][] = [];
    for (const requete of requetes) listes.push(await chercherUneFois(base, requete, n, f, reglages));
    return listes;
  };
  let listes = await chercherTout({ ...filtres, ...extraits }); // extraits : une date, des types, jamais un niveau d'accès
  // Un filtre extrait à tort peut écarter tous les passages : dans ce cas, on cherche sans les filtres extraits
  if (Object.keys(extraits).length > 0 && listes.every((l) => l.length === 0)) listes = await chercherTout(filtres);
  let resultats = listes[0];
  if (listes.length > 1) {
    const parId = new Map(listes.flat().map((r) => [r.id, r]));
    resultats = fusionner(listes.map((l) => l.map((r) => r.id))).slice(0, n).map((id) => parId.get(id)!);
  }
  // 4. Le score de chaque passage doit être sa similarité cosinus avec la question : c'est elle que compare le seuil
  // d'abstention du chapitre 7. Le plein texte donne un score BM25, sans maximum ; après une transformation, les scores
  // viennent des requêtes du LLM : on les recalcule avec la question
  if (reglages.mode === "plein-texte" || reglages.transformation) resultats = await avecSimilarites(base, question, resultats);
  // 5. Le choix des k passages parmi les candidats : le reclasseur lit la question et chaque candidat ; ou MMR, qui écarte
  // les redites ; sinon, les premiers. Le classement continue au-delà de k quand les traces demandent une profondeur
  const rendre = Math.max(k, profondeur);
  if (reglages.reclassement) {
    const reclasseur = reglages.reclasseur === "llm" ? parLeLlm(llm()) : outils.crossEncoder;
    if (!reclasseur) throw new Error("Ces réglages demandent un cross-encoder : passez-le dans les outils");
    return reclasser(question, resultats, reclasseur, rendre);
  }
  if (reglages.diversite !== null) {
    const v = await vecteurs(base, resultats.map((r) => r.id));
    return mmr(resultats.map((r) => ({ ...r, vecteur: v.get(r.id)! })), rendre, reglages.diversite);
  }
  return resultats.slice(0, rendre);
}

// Les mêmes passages, avec pour score leur similarité cosinus avec la question
async function avecSimilarites(base: Base, question: string, resultats: Resultat[]): Promise<Resultat[]> {
  const [vecteur] = await vectoriser([question], "requete");
  const scores = new Map((await similarites(base, vecteur, resultats.map((r) => r.id))).map((r) => [r.id, r.score]));
  return resultats.map((r) => ({ ...r, score: scores.get(r.id)! }));
}
