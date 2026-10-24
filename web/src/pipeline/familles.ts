// Chaque étape a une famille (sa couleur, discrète) et une icône. Une étape que l'interface ne connaît pas encore (le
// chapitre en ajoutera) tombe dans la famille « autre », avec l'icône générique
import type { NomIcone } from "../composants/Icone.tsx";

export type Famille = "recherche" | "llm" | "decision" | "outil" | "autre";

export const FAMILLES: Record<Famille, string> = {
  recherche: "Recherche",
  llm: "LLM",
  decision: "Décision",
  outil: "Outil",
  autre: "Autre",
};

const ETAPES: Record<string, { famille: Famille; icone: NomIcone }> = {
  "prompt-systeme": { famille: "llm", icone: "texte" },
  "tour-llm": { famille: "llm", icone: "etincelle" },
  "appel-llm": { famille: "llm", icone: "etincelle" },
  reponse: { famille: "llm", icone: "conversation" },
  outil: { famille: "outil", icone: "outil" },
  droits: { famille: "decision", icone: "bouclier" },
  "filtres-extraits": { famille: "decision", icone: "filtre" },
  "filtres-extraits-ecartes": { famille: "decision", icone: "filtre-barre" },
  seuil: { famille: "decision", icone: "jauge" },
  budget: { famille: "decision", icone: "pile" },
  limite: { famille: "decision", icone: "drapeau" },
  citations: { famille: "decision", icone: "citation" },
  condensation: { famille: "recherche", icone: "comparer" },
  transformation: { famille: "recherche", icone: "comparer" },
  embedding: { famille: "recherche", icone: "vecteur" },
  "recherche-vectorielle": { famille: "recherche", icone: "recherche" },
  "recherche-plein-texte": { famille: "recherche", icone: "document" },
  fusion: { famille: "recherche", icone: "fusion" },
  "fusion-requetes": { famille: "recherche", icone: "fusion" },
  similarites: { famille: "recherche", icone: "vecteur" },
  reclassement: { famille: "recherche", icone: "tri" },
  diversite: { famille: "recherche", icone: "liste" },
  "recherche-de-secours": { famille: "recherche", icone: "boucle" },
  verification: { famille: "decision", icone: "evaluations" },
  cache: { famille: "decision", icone: "eclair" },
  "cache-ecrit": { famille: "decision", icone: "base" },
  repli: { famille: "llm", icone: "relais" },
  degradation: { famille: "decision", icone: "alerte" },
};

export const familleDe = (nom: string): Famille => ETAPES[nom]?.famille ?? "autre";
export const iconeDe = (nom: string): NomIcone => ETAPES[nom]?.icone ?? "json";

// Les étapes qui appellent un modèle de langage : leur durée fait la part du LLM
export const ETAPES_LLM = new Set(["tour-llm", "appel-llm"]);
