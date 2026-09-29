// Vérifie la configuration avant de travailler : clés présentes, modèles accessibles.
// Lancement : npm run verifier. Le script n'affiche jamais la valeur d'une clé.
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { pipeline } from "@huggingface/transformers";
import { config } from "../config.ts";
import { pool } from "../db.ts";
import { conseilOllama, ollama } from "../ollama.ts";

async function verifier(nom: string, test: () => Promise<string>) {
  try {
    console.log(`OK     ${nom} : ${await test()}`);
  } catch (erreur) {
    console.log(`ÉCHEC  ${nom} : ${erreur instanceof Error ? erreur.message : String(erreur)}`);
    process.exitCode = 1;
  }
}

// Calcule le vecteur d'un court texte avec le fournisseur d'embeddings configuré
async function vecteurDeTest(): Promise<number[]> {
  if (config.EMBEDDING_PROVIDER === "openai") {
    const reponse = await new OpenAI().embeddings.create({ model: config.EMBEDDING_MODEL, input: "test" });
    return reponse.data[0].embedding;
  }
  if (config.EMBEDDING_PROVIDER === "voyage") {
    const reponse = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.VOYAGE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: config.EMBEDDING_MODEL, input: ["test"] }),
    });
    if (!reponse.ok) throw new Error(`HTTP ${reponse.status} : ${await reponse.text()}`);
    const donnees = (await reponse.json()) as { data: { embedding: number[] }[] };
    return donnees.data[0].embedding;
  }
  if (config.EMBEDDING_PROVIDER === "ollama") {
    const reponse = await ollama.embeddings.create({ model: config.EMBEDDING_MODEL, input: "test" }).catch(conseilOllama);
    return reponse.data[0].embedding;
  }
  const extraire = await pipeline("feature-extraction", config.EMBEDDING_MODEL, { dtype: "q8" });
  const tenseur = await extraire(["test"], { pooling: "mean", normalize: true });
  return tenseur.tolist()[0];
}

const presence = (cle?: string) => (cle ? "présente" : "absente");
console.log(`Génération : ${config.LLM_PROVIDER}, modèle ${config.LLM_MODEL}`);
console.log(`Embeddings : ${config.EMBEDDING_PROVIDER}, modèle ${config.EMBEDDING_MODEL}`);
console.log(
  `Clés       : Anthropic ${presence(config.ANTHROPIC_API_KEY)}, ` +
    `OpenAI ${presence(config.OPENAI_API_KEY)}, Voyage ${presence(config.VOYAGE_API_KEY)}\n`,
);

// 1. Le modèle qui rédige les réponses existe-t-il, et la clé y donne-t-elle accès ?
await verifier("modèle de génération", async () => {
  if (config.LLM_PROVIDER === "openai") return (await new OpenAI().models.retrieve(config.LLM_MODEL)).id;
  if (config.LLM_PROVIDER === "ollama") return (await ollama.models.retrieve(config.LLM_MODEL).catch(conseilOllama)).id;
  return (await new Anthropic().models.retrieve(config.LLM_MODEL)).display_name;
});

// 2. Le modèle d'embedding répond-il ?
await verifier("modèle d'embedding", async () => `${(await vecteurDeTest()).length} dimensions`);

// 3. La base répond-elle, et l'extension vector y est-elle active ?
await verifier("base de données", async () => {
  const { rows } = await pool
    .query<{ pg: string; vector: string | null }>(
      "SELECT current_setting('server_version') AS pg, (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS vector",
    )
    .catch((erreur: NodeJS.ErrnoException) => {
      throw new Error(`${erreur.message || erreur.code} (la base est-elle lancée ? npm run db:up)`);
    });
  if (!rows[0].vector) throw new Error("extension vector absente de la base");
  return `PostgreSQL ${rows[0].pg}, pgvector ${rows[0].vector}`;
});
await pool.end();
