// Le pipeline de Rhéa réécrit avec LangChain.js (chapitre 11) : un magasin de vecteurs sur la base de Rhéa, telle quelle,
// sans rien revectoriser ; un retriever ; un prompt ; le modèle de .env ; le tout enchaîné en une seule chaîne (LCEL).
// Ce que LangChain fournit remplace notre SQL de recherche vectorielle et nos appels aux modèles. Le plein texte et les
// filtres extraits du chapitre 9, le budget et l'abstention du chapitre 7 n'ont pas d'équivalent dans ces paquets ; la
// fusion et la condensation existent dans @langchain/classic, le paquet hérité, qu'on évite pour du code neuf. Pour
// garder tout le chapitre 9, on branche notre propre recherche (RetrieverRhea)
import { ChatAnthropic } from "@langchain/anthropic";
import { Document } from "@langchain/core/documents";
import { Embeddings } from "@langchain/core/embeddings";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { AIMessage } from "@langchain/core/messages";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { BaseRetriever } from "@langchain/core/retrievers";
import { type Runnable, RunnablePassthrough, RunnableSequence } from "@langchain/core/runnables";
import { ChatOpenAI } from "@langchain/openai";
import { PGVectorStore } from "@langchain/pgvector";
import type pg from "pg";
import { config } from "../config.ts";
import { vectoriser } from "../embeddings/fournisseurs.ts";
import { CITER } from "../generation/prompt.ts";
import type { Usage } from "../llm.ts";
import { trouverPassages } from "../recherche/passages.ts";
import type { Resultat } from "../recherche/vectorielle.ts";

// 1. Les embeddings de Rhéa, vus par LangChain : le même modèle et les mêmes réglages que ceux qui ont rempli la base
// (chapitre 3). Un autre modèle donnerait des vecteurs incomparables à ceux de la table chunks
export class EmbeddingsRhea extends Embeddings {
  constructor() {
    super({});
  }
  embedDocuments(textes: string[]) {
    return vectoriser(textes, "document");
  }
  async embedQuery(texte: string) {
    const [vecteur] = await vectoriser([texte], "requete");
    return vecteur;
  }
}

// 2. Le magasin lit une table avec une colonne de métadonnées en JSON. Une vue la fabrique à partir de la table chunks,
// sans rien copier. Les filtres de LangChain ne comparent que des nombres : les dates deviennent des entiers AAAAMMJJ,
// et un texte toujours en vigueur reçoit une fin lointaine
export const VUE = `
  CREATE OR REPLACE VIEW chunks_langchain AS
  SELECT id, texte, embedding,
         jsonb_build_object(
           'document', document, 'titres', titres, 'type', type, 'acces', acces,
           'debut', to_char(date_effet, 'YYYYMMDD')::int,
           'fin', coalesce(to_char(date_fin, 'YYYYMMDD')::int, 99991231)
         ) AS metadata
  FROM chunks`;

export async function creerMagasin(pool: pg.Pool): Promise<PGVectorStore> {
  await pool.query(VUE);
  return new PGVectorStore(new EmbeddingsRhea(), {
    pool,
    tableName: "chunks_langchain",
    skipInitializationCheck: true, // la table existe : ne rien créer
    columns: { idColumnName: "id", vectorColumnName: "embedding", contentColumnName: "texte", metadataColumnName: "metadata" },
    distanceStrategy: "cosine",
  });
}

// Le filtre de Rhéa dans la syntaxe de LangChain : ouvert à tous, et en vigueur ce jour-là. Les conditions sont reliées
// par ET, et il n'existe pas de OU : d'où la fin lointaine plutôt qu'une fin absente
export function filtreLangChain(date: string) {
  // LangChain n'écrit une comparaison que pour un nombre : une date mal écrite ferait disparaître le filtre sans message
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Date attendue au format AAAA-MM-JJ, reçu : ${date}`);
  const jour = Number(date.replaceAll("-", ""));
  return { acces: "tous", debut: { lte: jour }, fin: { gt: jour } };
}

// 3. Le modèle de .env, par les intégrations de LangChain : Ollama par son API compatible OpenAI, avec les réglages
// locaux de Rhéa (température 0, pas de réflexion, generation/generateur.ts). maxRetries : LangChain refait sinon
// jusqu'à six tentatives, ce qui fausserait les durées mesurées. modelKwargs part tel quel dans la requête
export function modeleLangChain(): BaseChatModel {
  if (config.LLM_PROVIDER === "anthropic") {
    return new ChatAnthropic({ model: config.LLM_MODEL, maxTokens: 1024, maxRetries: 0, apiKey: config.ANTHROPIC_API_KEY });
  }
  if (config.LLM_PROVIDER === "openai") {
    // store: false, comme Rhéa : OpenAI ne garde pas la réponse
    return new ChatOpenAI({ model: config.LLM_MODEL, maxTokens: 4096, maxRetries: 0, useResponsesApi: true, apiKey: config.OPENAI_API_KEY, modelKwargs: { store: false } });
  }
  return new ChatOpenAI({
    model: config.LLM_MODEL,
    temperature: 0,
    maxTokens: 1024,
    maxRetries: 0,
    useResponsesApi: true,
    // L'option reasoning de LangChain ne part qu'aux modèles d'OpenAI qu'il reconnaît : pour le modèle local, elle
    // serait ignorée sans message, et le modèle réfléchirait avant chaque réponse. On l'ajoute donc à la main
    modelKwargs: { reasoning: { effort: "none" } },
    configuration: { baseURL: `${config.OLLAMA_BASE_URL}/v1`, apiKey: "ollama" },
  });
}

// 4. Brancher notre propre recherche : un retriever LangChain qui appelle trouverPassages, avec tous les réglages du
// chapitre 9. La chaîne ne voit pas la différence
export class RetrieverRhea extends BaseRetriever {
  lc_namespace = ["rhea", "retrievers"];
  pool: pg.Pool;
  k: number;
  date: string;
  constructor(pool: pg.Pool, k: number, date: string) {
    super();
    this.pool = pool;
    this.k = k;
    this.date = date;
  }
  async _getRelevantDocuments(question: string): Promise<Document[]> {
    const resultats = await trouverPassages(this.pool, question, this.k, this.date);
    return resultats.map(versDocument);
  }
}

// Un passage de Rhéa devient un Document de LangChain, et inversement : les mêmes champs, rangés autrement
export const versDocument = (r: Resultat) =>
  new Document({ id: r.id, pageContent: r.texte, metadata: { document: r.document, titres: r.titres, score: r.score } });
export const versResultat = (d: Document): Resultat => ({
  id: String(d.id),
  document: String(d.metadata.document),
  titres: (d.metadata.titres as string[]) ?? [],
  texte: d.pageContent,
  score: Number(d.metadata.score ?? 0),
});

// Un passage entre balises, numéroté, comme dans le prompt de Rhéa (generation/prompt.ts)
const baliserDocument = (d: Document, i: number) =>
  `<passage numero="${i + 1}" source="${d.id}" titre="${((d.metadata.titres as string[]) ?? []).join(" > ")}">\n${d.pageContent}\n</passage>`;

const PROMPT = ChatPromptTemplate.fromMessages([
  ["system", "{systeme}"],
  ["human", "{consigne}\n\n<passages>\n{passages}\n</passages>\n\nDate du jour : {date}\n\nQuestion : {question}"],
]);

export type Entree = { question: string; date: string };
export type Sortie = Entree & { documents: Document[]; message: AIMessage };

// 5. La chaîne : chercher, puis remplir le prompt avec les passages, puis appeler le modèle. Chaque étape ajoute sa
// clé à l'objet qui circule : à la fin, on a les passages ET la réponse
export function creerChaine(chercher: (entree: Entree) => Promise<Document[]>, modele: BaseChatModel, systeme: string): Runnable<Entree, Sortie> {
  return RunnablePassthrough.assign<Entree, { documents: Document[] }>({ documents: chercher }).assign({
    message: RunnableSequence.from([
      (e: Entree & { documents: Document[] }) => ({
        systeme,
        consigne: CITER,
        passages: e.documents.map(baliserDocument).join("\n\n"),
        date: e.date,
        question: e.question,
      }),
      PROMPT,
      modele,
    ]),
  });
}

// Le texte et les tokens d'une réponse, quel que soit le fournisseur : LangChain range les tokens au même endroit
export function lireMessage(message: AIMessage): { texte: string; usage: Usage } {
  const u = message.usage_metadata;
  return {
    texte: message.text,
    usage: { entree: u?.input_tokens ?? 0, enCache: u?.input_token_details?.cache_read ?? 0, sortie: u?.output_tokens ?? 0 },
  };
}
