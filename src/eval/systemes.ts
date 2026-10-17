// Trois façons de répondre aux questions du jeu d'évaluation, derrière une même interface, pour les comparer (chapitre 11,
// leçon 4) : le pipeline maison des chapitres 6 à 9, sa réécriture avec LangChain (leçon 3) et le RAG géré d'OpenAI
// avec file_search (leçon 1). Chacune rend sa réponse, les passages qu'elle a lus, les sources citées, les tokens
// consommés et les appels de recherche facturés
import type { PGVectorStore } from "@langchain/pgvector";
import type OpenAI from "openai";
import type pg from "pg";
import { repondreEnFlux } from "../api/rhea.ts";
import { creerChaine, filtreLangChain, lireMessage, modeleLangChain, versResultat } from "../frameworks/langchain.ts";
import { MESSAGE_ABSTENTION } from "../generation/abstention.ts";
import { numerosCites } from "../generation/citations.ts";
import { creerGenerateurEnFlux } from "../generation/generateur.ts";
import { BUDGET_PASSAGES, PASSAGES_DEMANDES } from "../generation/prompt.ts";
import type { PromptSysteme } from "../generation/systeme.ts";
import { avecCitations, repondreAvecFileSearch } from "../gere/file-search.ts";
import { filtreEnVigueur } from "../gere/store.ts";
import { creerLlm, type Llm, type Usage } from "../llm.ts";
import { condenser, type Echange } from "../recherche/conversation.ts";
import { outilsParDefaut, trouverPassages } from "../recherche/passages.ts";
import { RECHERCHE } from "../recherche/reglages.ts";
import type { Resultat } from "../recherche/vectorielle.ts";

export type Passage = { id?: string; document: string; texte: string }; // id : un passage de Rhéa ; OpenAI n'en donne pas
export type ReponseSysteme = { reponse: string; passages: Passage[]; cites: string[]; usage: Usage; recherches: number };
export type Systeme = (question: string, date: string, historique: Echange[]) => Promise<ReponseSysteme>;

const ZERO: Usage = { entree: 0, enCache: 0, sortie: 0 };
export const additionner = (a: Usage, b: Usage): Usage => ({
  entree: a.entree + b.entree,
  enCache: a.enCache + b.enCache,
  sortie: a.sortie + b.sortie,
  ...((a.ecritCache !== undefined || b.ecritCache !== undefined) && { ecritCache: (a.ecritCache ?? 0) + (b.ecritCache ?? 0) }),
});

// 1. Le pipeline maison, tel qu'en production (src/api/rhea.ts) : la recherche du chapitre 9, l'abstention, le prompt
// augmenté, les citations vérifiées. Les tokens comptent aussi les appels au LLM de la recherche (filtres extraits,
// condensation) : un LLM qui compte ce qu'il consomme remplace celui de .env
export function systemeMaison(pool: pg.Pool, systeme: PromptSysteme): Systeme {
  const generer = creerGenerateurEnFlux();
  const llmDeEnv = creerLlm();
  return async (question, date, historique) => {
    let usage = ZERO;
    const llm: Llm = async (debut, fin) => {
      const r = await llmDeEnv(debut, fin);
      usage = additionner(usage, r.usage);
      return r;
    };
    const outils = { ...outilsParDefaut(), llm };
    let lus: Resultat[] = [];
    let texte = "";
    let cites: string[] = [];
    let abstention = false;
    const evenements = repondreEnFlux(
      question,
      {
        chercher: (q, d) => trouverPassages(pool, q, PASSAGES_DEMANDES, d, RECHERCHE, outils),
        generer: (prompt, signal) => {
          lus = prompt.passages; // les passages que le LLM lira
          return generer(prompt, signal);
        },
        systeme,
        budget: BUDGET_PASSAGES,
        date: () => date,
        condenser: (q, h) => condenser(q, h, llm),
      },
      undefined,
      historique,
    );
    for await (const e of evenements) {
      if (e.nom === "texte") texte += e.donnees.texte;
      else if (e.nom === "sources") cites = e.donnees.map((s) => s.source);
      else if (e.nom === "abstention") abstention = true;
      else if (e.nom === "fin" && e.donnees.usage) usage = additionner(usage, e.donnees.usage);
    }
    return {
      reponse: abstention ? MESSAGE_ABSTENTION : texte.trim(),
      passages: lus.map((p) => ({ id: p.id, document: p.document, texte: p.texte })),
      cites: abstention ? [] : cites,
      usage,
      recherches: 0,
    };
  };
}

// 2. La réécriture LangChain de la leçon 3, telle qu'un développeur l'obtient avec les briques du framework : recherche
// vectorielle seule, filtres d'accès et de date, prompt de Rhéa. Ni condensation (l'historique est ignoré), ni seuil
// d'abstention, ni vérification des citations : ce sont nos ajouts des chapitres 7 et 9
export function systemeLangChain(magasin: PGVectorStore, systeme: PromptSysteme): Systeme {
  const chaine = creerChaine(
    (e) => magasin.asRetriever({ k: PASSAGES_DEMANDES, filter: filtreLangChain(e.date) }).invoke(e.question),
    modeleLangChain(),
    systeme.texte,
  );
  return async (question, date) => {
    const sortie = await chaine.invoke({ question, date });
    const { texte, usage } = lireMessage(sortie.message);
    const passages = sortie.documents.map(versResultat);
    return {
      reponse: texte.trim(),
      passages: passages.map((p) => ({ id: p.id, document: p.document, texte: p.texte })),
      cites: numerosCites(texte, passages).map((n) => passages[n - 1].id),
      usage,
      recherches: 0,
    };
  };
}

// 3. Le RAG géré d'OpenAI : file_search dans le vector store, avec le filtre de date et autant de passages que Rhéa en
// demande. Le modèle reçoit l'historique : c'est lui qui comprend une question de suite
export function systemeFileSearch(client: OpenAI, modele: string, store: string, systeme: PromptSysteme): Systeme {
  return async (question, date, historique) => {
    const r = await repondreAvecFileSearch(
      client,
      modele,
      { systeme: systeme.texte, question, date, historique, store, filtres: filtreEnVigueur(date) },
      { k: PASSAGES_DEMANDES },
    );
    return {
      reponse: avecCitations(r.texte, r.citations).trim(),
      passages: r.passages.map((p) => ({ document: p.document, texte: p.texte })),
      cites: [...new Set(r.citations.map((c) => c.document))],
      usage: r.usage,
      recherches: r.recherches,
    };
  };
}
