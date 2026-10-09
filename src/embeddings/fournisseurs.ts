// Calculer des embeddings avec le fournisseur choisi dans .env : Transformers.js, OpenAI, Voyage ou Ollama.
// Le reste du projet appelle seulement vectoriser(textes, usage), sans savoir quel fournisseur répond.
import OpenAI from "openai";
import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { config, type Config } from "../config.ts";
import { conseilOllama, ollama } from "../ollama.ts";
import { avecReprises, parLots } from "./lots.ts";
import { normaliser } from "./similarite.ts";

// La question d'un salarié (requête) ou un passage du corpus (document) : certains modèles les encodent différemment
export type Usage = "requete" | "document";
export type Embedder = (textes: string[], usage: Usage) => Promise<number[][]>;
type Reglages = Pick<Config, "EMBEDDING_PROVIDER" | "EMBEDDING_MODEL" | "EMBEDDING_DIMENSIONS" | "VOYAGE_API_KEY">;

const TAILLE_LOT = 32; // textes envoyés par appel

// Les modèles de la famille e5 attendent un préfixe qui dit si le texte est une requête ou un document
const prefixe = (modele: string, usage: Usage) =>
  /e5/i.test(modele) ? (usage === "requete" ? "query: " : "passage: ") : "";

// Modèle local, chargé au premier appel. Vecteur d'un texte : son premier token (cls) avec BGE, la moyenne sinon
function appelTransformers(r: Reglages): Embedder {
  let extraire: Promise<FeatureExtractionPipeline> | undefined;
  return async (textes, usage) => {
    extraire ??= pipeline("feature-extraction", r.EMBEDDING_MODEL, { dtype: "q8" });
    const entrees = textes.map((t) => prefixe(r.EMBEDDING_MODEL, usage) + t);
    const tenseur = await (await extraire)(entrees, { pooling: /bge/i.test(r.EMBEDDING_MODEL) ? "cls" : "mean", normalize: true });
    return tenseur.tolist();
  };
}

// OpenAI : pas de distinction entre requête et document. dimensions réduit la taille des vecteurs
function appelOpenAI(r: Reglages): Embedder {
  const client = new OpenAI({ maxRetries: 0 }); // les reprises sont faites par avecReprises
  return async (textes) => {
    const { data } = await client.embeddings.create({ model: r.EMBEDDING_MODEL, input: textes, dimensions: r.EMBEDDING_DIMENSIONS });
    return data.map((d) => d.embedding);
  };
}

// Voyage : input_type indique au modèle s'il encode une requête ou un document
function appelVoyage(r: Reglages): Embedder {
  return async (textes, usage) => {
    const reponse = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${r.VOYAGE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: r.EMBEDDING_MODEL,
        input: textes,
        input_type: usage === "requete" ? "query" : "document",
        output_dimension: r.EMBEDDING_DIMENSIONS, // absent du JSON s'il n'est pas défini
      }),
    });
    if (!reponse.ok) {
      // on garde le statut HTTP sur l'erreur : avecReprises s'en sert pour décider d'un nouvel essai
      throw Object.assign(new Error(`Voyage : HTTP ${reponse.status} ${await reponse.text()}`), { status: reponse.status });
    }
    const { data } = (await reponse.json()) as { data: { embedding: number[] }[] };
    return data.map((d) => d.embedding);
  };
}

// Ollama : serveur local, avec la même API que celle d'OpenAI
function appelOllama(r: Reglages): Embedder {
  return async (textes, usage) => {
    const entrees = textes.map((t) => prefixe(r.EMBEDDING_MODEL, usage) + t);
    const { data } = await ollama.embeddings
      .create({ model: r.EMBEDDING_MODEL, input: entrees, dimensions: r.EMBEDDING_DIMENSIONS })
      .catch(conseilOllama);
    return data.map((d) => d.embedding);
  };
}

const APPELS = { transformers: appelTransformers, openai: appelOpenAI, voyage: appelVoyage, ollama: appelOllama };

export function creerEmbedder(reglages: Reglages = config): Embedder {
  const appel = APPELS[reglages.EMBEDDING_PROVIDER](reglages);
  // Les reprises servent aux API distantes (limite de débit, panne passagère), pas à un modèle local
  const distant = reglages.EMBEDDING_PROVIDER === "openai" || reglages.EMBEDDING_PROVIDER === "voyage";
  return async (textes, usage) => {
    const vecteurs = await parLots(textes, TAILLE_LOT, (lot) => (distant ? avecReprises(() => appel(lot, usage)) : appel(lot, usage)));
    return vecteurs.map(normaliser); // longueur 1 : ensuite, le produit scalaire suffit
  };
}

// L'embedder configuré dans .env, celui qu'utilise tout le projet
export const vectoriser = creerEmbedder();

// Le nom complet du modèle configuré : deux noms différents donnent des vecteurs qui ne se comparent pas
export const nomDuModele = (r: Reglages = config) => [r.EMBEDDING_PROVIDER, r.EMBEDDING_MODEL, r.EMBEDDING_DIMENSIONS].filter(Boolean).join(" ");
