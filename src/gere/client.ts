// Le client OpenAI des outils du vector store, avec la clé de .env : il en faut une même quand Rhéa répond avec un autre
// fournisseur, puisque le store est chez OpenAI
import OpenAI from "openai";
import { config } from "../config.ts";

export function clientOpenAI(): OpenAI {
  if (!config.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY manque dans .env : le vector store est chez OpenAI");
  return new OpenAI({ apiKey: config.OPENAI_API_KEY });
}
