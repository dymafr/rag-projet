// La trace d'une question (chapitre 14) : chaque étape de Rhéa, ce qu'elle a reçu et rendu, son temps et, pour un appel
// de modèle, ses tokens. C'est ce qu'on regarde quand une réponse est fausse : sans elle, on ne sait pas si la faute vient
// de la recherche, du seuil d'abstention, du budget ou du LLM.
// Les fonctions de Rhéa n'ont pas à se passer la trace de main en main : AsyncLocalStorage (node:async_hooks) la garde
// pour tout ce qui s'exécute pendant la question, même à travers les await. Une étape lancée sans trace (un test, un outil
// en ligne de commande) s'exécute comme avant, sans rien noter
import { AsyncLocalStorage } from "node:async_hooks";
import { pourLeTerminal } from "../ingestion/secrets.ts";
import type { Usage } from "../llm.ts";

export type Modele = { fournisseur: string; modele: string };

// Ce qu'une étape dit d'elle-même : une ligne pour l'humain, puis tout le détail, en JSON
export type Description = { resume: string; details?: Record<string, unknown>; usage?: Usage; modele?: Modele };

export type EtapeTracee = {
  id: number; // le numéro de l'étape dans la question : 1, 2, 3…
  parent: number | null; // l'étape qui la contient (la recherche d'un appel d'outil), null au premier niveau
  nom: string; // un nom stable, pour les programmes : recherche-vectorielle, tour-llm…
  titre: string; // ce que lit l'humain : « Recherche vectorielle »
  debut_ms: number; // depuis le début de la question
  duree_ms: number;
  statut: "ok" | "erreur";
  resume: string;
  details: Record<string, unknown>;
  usage?: Usage; // pour une étape qui appelle un modèle
  modele?: Modele;
};

// Ce que reçoit celui qui écoute la trace (le serveur, qui l'envoie à l'interface) : le début de chaque étape, pour
// montrer ce qui est en cours, puis sa fin, complète
export type EvenementTrace =
  | { type: "debut"; etape: Pick<EtapeTracee, "id" | "parent" | "nom" | "titre" | "debut_ms"> }
  | { type: "fin"; etape: EtapeTracee };

export class Trace {
  readonly etapes: EtapeTracee[] = [];
  readonly ecouter?: (evenement: EvenementTrace) => void;
  readonly #origine = performance.now();
  #suivante = 1;

  constructor(ecouter?: (evenement: EvenementTrace) => void) {
    this.ecouter = ecouter;
  }

  numero(): number {
    return this.#suivante++;
  }

  maintenant(): number {
    return Math.round(performance.now() - this.#origine);
  }

  terminer(etape: EtapeTracee) {
    this.etapes.push(etape);
    this.ecouter?.({ type: "fin", etape });
  }
}

const enCours = new AsyncLocalStorage<{ trace: Trace; parent: number | null }>();

// Exécuter fn avec cette trace : toutes les étapes lancées pendant fn s'y notent
export const avecTrace = <T>(trace: Trace, fn: () => T): T => enCours.run({ trace, parent: null }, fn);

// La trace en cours, s'il y en a une
export const traceEnCours = (): Trace | undefined => enCours.getStore()?.trace;

// Une description ratée ne doit jamais faire échouer la question : l'étape a réussi, seule sa trace est incomplète
function decrireSansRisque<T>(decrire: (resultat: T) => Description, resultat: T): Description {
  try {
    return decrire(resultat);
  } catch (erreur) {
    return { resume: "étape réussie (description impossible)", details: { erreur: pourLeTerminal(erreur) } };
  }
}

// Une étape : fn s'exécute, puis decrire tire de son résultat le résumé et le détail. Les étapes lancées pendant fn
// deviennent ses enfants. Une erreur est notée (caviardée : chapitre 13), puis relancée telle quelle
export async function etape<T>(nom: string, titre: string, fn: () => Promise<T>, decrire: (resultat: T) => Description): Promise<T> {
  const contexte = enCours.getStore();
  if (!contexte) return fn();
  const { trace, parent } = contexte;
  const id = trace.numero();
  const debut = performance.now();
  const debut_ms = trace.maintenant();
  trace.ecouter?.({ type: "debut", etape: { id, parent, nom, titre, debut_ms } });
  const terminer = (statut: EtapeTracee["statut"], d: Description) =>
    trace.terminer({
      id,
      parent,
      nom,
      titre,
      debut_ms,
      duree_ms: Math.round(performance.now() - debut),
      statut,
      resume: d.resume,
      details: d.details ?? {},
      ...(d.usage && { usage: d.usage }),
      ...(d.modele && { modele: d.modele }),
    });
  try {
    const resultat = await enCours.run({ trace, parent: id }, fn);
    terminer("ok", decrireSansRisque(decrire, resultat));
    return resultat;
  } catch (erreur) {
    terminer("erreur", { resume: `échec : ${pourLeTerminal(erreur instanceof Error ? erreur.message : erreur)}` });
    throw erreur;
  }
}

// Une étape sans durée : une décision prise sur ce qu'on sait déjà (un seuil, un budget, un refus)
export function noter(nom: string, titre: string, description: Description) {
  const contexte = enCours.getStore();
  if (!contexte) return;
  const { trace, parent } = contexte;
  const id = trace.numero();
  const debut_ms = trace.maintenant();
  trace.ecouter?.({ type: "debut", etape: { id, parent, nom, titre, debut_ms } });
  trace.terminer({ id, parent, nom, titre, debut_ms, duree_ms: 0, statut: "ok", resume: description.resume, details: description.details ?? {} });
}

// Les résumés se lisent en français : une virgule décimale (0,612), et un mot au pluriel seulement au-delà de un
export const nombre = (x: number, decimales = 3) => x.toFixed(decimales).replace(".", ",");
export const pluriel = (n: number, mot: string, pluriel = `${mot}s`) => `${n} ${n > 1 ? pluriel : mot}`;

// Le début d'un long texte, pour un résumé ou un détail qui reste lisible
export const apercu = (texte: string, longueur = 160) => (texte.length <= longueur ? texte : `${texte.slice(0, longueur - 1)}…`);

// Un passage dans une trace : de quoi le reconnaître et le classer, sans son texte entier (l'interface le relit à la
// demande, avec les droits de celui qui regarde)
export const enBref = (p: { id: string; document: string; titres: string[]; score: number }) => ({
  id: p.id,
  document: p.document,
  titre: p.titres.join(" > "),
  score: Number(p.score.toFixed(4)),
});
