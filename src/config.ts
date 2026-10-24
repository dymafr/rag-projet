// Lecture et validation de la configuration du projet, lue dans le fichier .env
import { z } from "zod";

z.config(z.locales.fr()); // messages d'erreur en français

const Schema = z
  .object({
    LLM_PROVIDER: z.enum(["anthropic", "openai", "ollama"]).default("anthropic"),
    LLM_MODEL: z.string().min(1, "indiquez le modèle qui rédige les réponses"),
    JUGE_MODEL: z.string().optional(), // le modèle du juge d'évaluation ; vide ou absent : LLM_MODEL
    // Chapitre 14 : le juge peut venir d'un autre fournisseur que celui qui rédige (un juge juge moins bien son propre
    // fournisseur) ; absent : LLM_PROVIDER
    JUGE_PROVIDER: z.enum(["anthropic", "openai", "ollama"]).optional(),
    EMBEDDING_PROVIDER: z.enum(["transformers", "openai", "voyage", "ollama"]).default("transformers"),
    EMBEDDING_MODEL: z.string().min(1, "indiquez le modèle d'embedding"),
    EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().optional(), // taille réduite des vecteurs, si le modèle le permet
    // Chapitre 14, leçon 3 : contextualiser chaque chunk au découpage (chapitre 5, leçon 5), avec le LLM de .env
    CONTEXTUALISER: z.stringbool({ truthy: ["oui", "true", "1"], falsy: ["non", "false", "0"] }).default(false),
    // Chapitre 14, leçon 3 : reclasser les passages dans la recherche de Rhéa (non par défaut : RECHERCHE, chapitre 9), et
    // avec quoi : le cross-encoder local (Transformers.js, chapitre 9), celui de Voyage (rerank-3, rerank-3-lite) ou le LLM
    RECLASSEMENT: z.stringbool({ truthy: ["oui", "true", "1"], falsy: ["non", "false", "0"] }).default(false),
    RERANK_PROVIDER: z.enum(["transformers", "voyage", "llm"]).default("transformers"),
    RERANK_MODEL: z.string().min(1).default("onnx-community/bge-reranker-v2-m3-ONNX"), // le cross-encoder local (chapitre 9)
    // Chapitre 14 : l'adresse de l'API de Voyage. Ses clés se créent désormais dans MongoDB Atlas, et l'API répond sur
    // ai.mongodb.com ; eu.ai.mongodb.com garde les textes en Europe (la clé doit être créée pour cette géographie)
    VOYAGE_BASE_URL: z.url().default("https://ai.mongodb.com/v1"),
    FILE_SEARCH_MODEL: z.string().optional(), // le modèle OpenAI qui répond avec l'outil file_search (chapitre 11)
    VISION_MODEL: z.string().optional(), // le modèle de vision, servi par Ollama (chapitre 12) ; absent : LLM_MODEL si LLM_PROVIDER=ollama
    ANTHROPIC_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    VOYAGE_API_KEY: z.string().optional(),
    OLLAMA_BASE_URL: z.url().default("http://localhost:11434"),
    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "attendu : postgres://utilisateur:mot-de-passe@hôte:port/base"),
    // Chapitre 14 : le mode inspection. Le serveur envoie alors à l'interface la trace de chaque étape (passages, prompt,
    // tokens) et ouvre ses routes /api. Utile pour développer ; à couper en production (non), où il en dirait trop
    INSPECTION: z.stringbool({ truthy: ["oui", "true", "1"], falsy: ["non", "false", "0"] }).default(true),
    // Chapitre 14, leçon 4 : vérifier chaque réponse contre ses sources avant de la rendre (un appel au LLM de plus). Non
    // par défaut : mesurée sur le jeu de travail, elle retirait plus de réponses justes qu'elle n'en corrigeait de fausses
    VERIFICATION: z.stringbool({ truthy: ["oui", "true", "1"], falsy: ["non", "false", "0"] }).default(false),
  })
  .superRefine((env, ctx) => {
    // Chaque fournisseur utilisé doit avoir sa clé
    const cles = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", voyage: "VOYAGE_API_KEY" } as const;
    for (const fournisseur of new Set([env.LLM_PROVIDER, env.JUGE_PROVIDER ?? env.LLM_PROVIDER, env.EMBEDDING_PROVIDER, env.RERANK_PROVIDER])) {
      if (fournisseur === "transformers" || fournisseur === "ollama" || fournisseur === "llm") continue; // local, ou le LLM déjà vérifié
      const cle = cles[fournisseur];
      if (!env[cle]) {
        ctx.addIssue({ code: "custom", path: [cle], message: `clé requise, car le fournisseur ${fournisseur} est utilisé` });
      }
    }
    // Le reclasseur de Voyage a ses propres modèles : le nom du modèle local n'y existe pas
    if (env.RERANK_PROVIDER === "voyage" && env.RERANK_MODEL.includes("/")) {
      ctx.addIssue({ code: "custom", path: ["RERANK_MODEL"], message: "indiquez un reclasseur de Voyage, par exemple RERANK_MODEL=rerank-3" });
    }
    // Un juge d'un autre fournisseur a son modèle à lui : celui de LLM_MODEL n'existe pas chez ce fournisseur
    if (env.JUGE_PROVIDER && env.JUGE_PROVIDER !== env.LLM_PROVIDER && !env.JUGE_MODEL) {
      ctx.addIssue({ code: "custom", path: ["JUGE_MODEL"], message: "indiquez le modèle du juge, car JUGE_PROVIDER n'est pas LLM_PROVIDER" });
    }
    // Transformers.js renvoie toujours la dimension native du modèle
    if (env.EMBEDDING_DIMENSIONS && env.EMBEDDING_PROVIDER === "transformers") {
      ctx.addIssue({ code: "custom", path: ["EMBEDDING_DIMENSIONS"], message: "non pris en charge avec transformers : retirez la ligne" });
    }
  });

export type Config = z.infer<typeof Schema>;

const resultat = Schema.safeParse(process.env);
if (!resultat.success) {
  console.error("Configuration invalide dans .env :\n" + z.prettifyError(resultat.error));
  process.exit(1);
}

export const config: Config = resultat.data;
