// Savoir répondre « je ne sais pas » : avant le LLM, quand aucun passage n'est assez proche de la question ;
// après, quand la réponse ne s'appuie sur aucune source vérifiable
import type { Resultat } from "../recherche/vectorielle.ts";
import type { CitationVerifiee } from "./citations.ts";

// Le score du meilleur passage en dessous duquel la question est jugée hors du corpus. Un score cosinus n'est pas
// une probabilité, et sa plage dépend du modèle d'embedding : ce seuil a été mesuré avec npm run seuils, sur nos
// questions et avec ce modèle-là. À mesurer de nouveau si l'un ou l'autre change
export const SEUIL = 0.49;
export const MODELE_DU_SEUIL = "transformers Xenova/bge-m3";
// Chapitre 14, leçon 4 : un seuil fixe ne sépare pas les questions couvertes des questions hors corpus. Sur le jeu de
// travail (exécution de référence du 20 octobre 2026), « Ai-je droit à un congé sabbatique ? », hors corpus, obtient 0,628,
// et « le pont de l'Ascension est offert ? », couverte, 0,421 : aucun seuil ne garde l'une sans écarter l'autre. L'agent
// ne s'en sert donc plus pour décider. Il garde un plancher, très bas, sous lequel rien ne vaut la peine d'être lu (la météo,
// une recette) ; au-dessus, c'est l'agent qui décide : il lit les passages et dit quand ils ne répondent pas (son prompt).
// La vérification de la réponse (verification.ts, VERIFICATION=oui) peut en plus contrôler chaque affirmation.
// Comme le seuil, le plancher se mesure pour chaque modèle d'embedding : text-embedding-3-small donne des cosinus plus
// bas que bge-m3. Mesures du 20 octobre 2026 sur les 240 questions : le plus haut plancher qui ne prive aucune question
// couverte de ses passages
export const PLANCHERS: Record<string, number> = {
  "transformers Xenova/bge-m3": 0.4, // 10 questions hors corpus sur 30 écartées
  "openai text-embedding-3-small": 0.3, // 11 sur 30
};
export const PLANCHER = PLANCHERS[MODELE_DU_SEUIL];
// Un modèle dont le plancher n'a pas été mesuré : aucun plancher, l'agent reçoit les passages de toute question
export const plancherPour = (modele: string) => PLANCHERS[modele] ?? 0;
// Le plancher de ce modèle a-t-il été mesuré ? C'est lui que l'agent applique ; le seuil du chapitre 7 ne sert plus
// qu'au pipeline sans agent (npm run repondre)
export const plancherMesure = (modele: string) => modele in PLANCHERS;

export const MESSAGE_ABSTENTION =
  "Je ne trouve pas cette information dans la documentation RH de Kalyo. Pour une question RH, vous pouvez ouvrir un ticket dans l'espace RH.";

// Le score du passage le plus proche de la question (0 sans passage). Ce n'est pas forcément celui du premier : depuis le
// chapitre 9, la fusion et le reclassement changent l'ordre des passages, pas leurs scores
export const meilleurScore = (resultats: Resultat[]) => Math.max(0, ...resultats.map((r) => r.score));

// 1. Avant le LLM : même le passage le plus proche est loin de la question
export const horsCorpus = (resultats: Resultat[], seuil = SEUIL) => meilleurScore(resultats) < seuil;

// 2. Après le LLM : pas de source, pas de réponse. Quand la réponse donne des extraits (en JSON, ou avec Claude),
// il en faut au moins un retrouvé dans son passage ; sinon, au moins un numéro de passage cité
export const appuyee = (numeros: number[], citations: CitationVerifiee[]) =>
  citations.length > 0 ? citations.some((c) => c.trouvee) : numeros.length > 0;
