// Les réglages de la recherche de Rhéa (chapitre 9). Chaque étape ajoutée au fil du chapitre a le sien ; elle n'entre
// dans RECHERCHE qu'après avoir été mesurée sur le jeu d'évaluation. Ce fichier ne fait que décrire : il ne lit pas .env
// et ne se connecte à rien, les outils et les tests peuvent l'importer sans rien lancer
import type { Transformation } from "./transformations.ts";

// vectorielle : les passages les plus proches par le sens (chapitre 6) ; plein-texte : ceux qui contiennent les mots ;
// hybride : les deux, fusionnés par leurs rangs
export const MODES = ["vectorielle", "plein-texte", "hybride"] as const;
export const RECLASSEURS = ["cross-encoder", "llm"] as const;
// Le LLM lit tous ses candidats dans un seul prompt : au-delà de 20, le prompt risque de dépasser la fenêtre de contexte
// d'un modèle local (rerank.ts)
export const CANDIDATS_LLM = 20;
// Chapitre 14 : un modèle hébergé lit sans peine 40 candidats (environ 7 000 tokens). Sur le jeu de production, le passage
// qui répond arrivait jusqu'au 27e rang de la recherche hybride (une politique en anglais, pour une question en français)
export const CANDIDATS_LLM_HEBERGE = 40;

export type Reglages = {
  mode: (typeof MODES)[number];
  candidats: number; // les passages que chaque recherche propose à la fusion, puis au reclassement ou à MMR
  poids: [number, number]; // en hybride : le poids de la recherche vectorielle, puis celui du plein texte (leçon 3)
  vocabulaire: boolean; // enrichir la requête du plein texte avec les sigles et synonymes du lexique (leçon 4)
  reclassement: boolean; // reclasser les candidats (leçon 5)
  reclasseur: (typeof RECLASSEURS)[number]; // le cross-encoder local de .env, ou le LLM du projet
  transformation: Transformation | null; // transformer la question avec le LLM avant de chercher (leçon 6)
  filtresExtraits: boolean; // appliquer la date ou le type de document que la question précise (leçon 7)
  condensation: boolean; // condenser une question de suite avec l'historique, avant de chercher (leçon 8)
  diversite: number | null; // le lambda de MMR : des passages pertinents et différents (leçon 9) ; null : sans MMR
};

// Les réglages de Rhéa : ceux de l'API et des évaluations, sauf option contraire. Chacun a été choisi sur le jeu
// d'évaluation (voir les leçons) : ce qui n'a pas gagné, ou coûte trop de temps, reste désactivé
export const RECHERCHE: Reglages = {
  mode: "hybride",
  candidats: 50,
  poids: [1, 0.5],
  vocabulaire: false,
  reclassement: false,
  reclasseur: "cross-encoder",
  transformation: null,
  filtresExtraits: true,
  condensation: true,
  diversite: null,
};
