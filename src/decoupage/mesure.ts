// Mesurer la taille d'un texte : en caractères, ou en tokens, comme les compte le tokenizer du découpage (chapitre 14)
import { AutoTokenizer } from "@huggingface/transformers";
import type { Config } from "../config.ts";

export type Mesure = (texte: string) => number;

export const enCaracteres: Mesure = (texte) => texte.length;

// Chapitre 14, leçon 3 : on compte toujours avec le même tokenizer, celui du modèle d'embedding local du projet, quel que
// soit le modèle configuré. Chaque modèle a son tokenizer : compter avec celui du modèle choisi redécouperait le corpus à
// chaque changement de modèle (on estimait jusqu'ici 4 caractères par token pour un modèle hébergé, et 64 passages sur
// 463 changeaient). Or les passages, et leurs identifiants que citent les jeux d'évaluation, doivent rester les mêmes.
// Il se charge comme un modèle, depuis le cache local
export const TOKENIZER_DU_DECOUPAGE = "Xenova/bge-m3";

// Les tokens du découpage, et le nombre maximal que lit le modèle d'embedding (au-delà, le texte est tronqué) : connu pour
// un modèle local ; un modèle hébergé lit bien plus que nos passages
export async function mesureDuModele(reglages: Pick<Config, "EMBEDDING_PROVIDER" | "EMBEDDING_MODEL">) {
  const tokenizer = await AutoTokenizer.from_pretrained(TOKENIZER_DU_DECOUPAGE);
  const mesure: Mesure = (texte) => tokenizer.encode(texte, { add_special_tokens: false }).length;
  if (reglages.EMBEDDING_PROVIDER !== "transformers") return { mesure, limite: Infinity };
  const local = reglages.EMBEDDING_MODEL === TOKENIZER_DU_DECOUPAGE ? tokenizer : await AutoTokenizer.from_pretrained(reglages.EMBEDDING_MODEL);
  return { mesure, limite: local.model_max_length };
}
