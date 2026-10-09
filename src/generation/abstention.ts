// Savoir répondre « je ne sais pas » : avant le LLM, quand aucun passage n'est assez proche de la question ;
// après, quand la réponse ne s'appuie sur aucune source vérifiable
import type { Resultat } from "../recherche/vectorielle.ts";
import type { CitationVerifiee } from "./citations.ts";

// Le score du meilleur passage en dessous duquel la question est jugée hors du corpus. Un score cosinus n'est pas
// une probabilité, et sa plage dépend du modèle d'embedding : ce seuil a été mesuré avec npm run seuils, sur nos
// questions et avec ce modèle-là. À mesurer de nouveau si l'un ou l'autre change
export const SEUIL = 0.49;
export const MODELE_DU_SEUIL = "transformers Xenova/bge-m3";

export const MESSAGE_ABSTENTION =
  "Je ne trouve pas cette information dans la documentation RH de Kalyo. Pour une question RH, vous pouvez ouvrir un ticket dans l'espace RH.";

// 1. Avant le LLM : même le passage le plus proche est loin de la question
export const horsCorpus = (resultats: Resultat[], seuil = SEUIL) => (resultats[0]?.score ?? 0) < seuil;

// 2. Après le LLM : pas de source, pas de réponse. Quand la réponse donne des extraits (en JSON, ou avec Claude),
// il en faut au moins un retrouvé dans son passage ; sinon, au moins un numéro de passage cité
export const appuyee = (numeros: number[], citations: CitationVerifiee[]) =>
  citations.length > 0 ? citations.some((c) => c.trouvee) : numeros.length > 0;
