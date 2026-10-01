// Mesurer la taille d'un texte : en caractères, ou en tokens, comme les compte le modèle d'embedding
import { AutoTokenizer } from "@huggingface/transformers";
import type { Config } from "../config.ts";

export type Mesure = (texte: string) => number;

export const enCaracteres: Mesure = (texte) => texte.length;

// Sans le tokenizer du modèle (OpenAI, Voyage ou Ollama) : une estimation, environ 4 caractères par token
const tokensEstimes: Mesure = (texte) => Math.ceil(texte.length / 4);

// Les tokens du modèle d'embedding, et le nombre maximal qu'il lit (au-delà, le texte est tronqué).
// Le tokenizer d'un modèle Transformers.js se charge comme le modèle, depuis le cache local
export async function mesureDuModele(reglages: Pick<Config, "EMBEDDING_PROVIDER" | "EMBEDDING_MODEL">) {
  if (reglages.EMBEDDING_PROVIDER !== "transformers") return { mesure: tokensEstimes, limite: Infinity, estimee: true };
  const tokenizer = await AutoTokenizer.from_pretrained(reglages.EMBEDDING_MODEL);
  const mesure: Mesure = (texte) => tokenizer.encode(texte, { add_special_tokens: false }).length;
  return { mesure, limite: tokenizer.model_max_length, estimee: false };
}
