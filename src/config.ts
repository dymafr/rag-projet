// Lecture et validation de la configuration du projet, lue dans le fichier .env
import { z } from "zod";

z.config(z.locales.fr()); // messages d'erreur en français

const Schema = z
  .object({
    LLM_PROVIDER: z.enum(["anthropic", "openai"]).default("anthropic"),
    LLM_MODEL: z.string().min(1, "indiquez le modèle qui rédige les réponses"),
    EMBEDDING_PROVIDER: z.enum(["transformers", "openai", "voyage"]).default("transformers"),
    EMBEDDING_MODEL: z.string().min(1, "indiquez le modèle d'embedding"),
    ANTHROPIC_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    VOYAGE_API_KEY: z.string().optional(),
    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "attendu : postgres://utilisateur:mot-de-passe@hôte:port/base"),
  })
  .superRefine((env, ctx) => {
    // Chaque fournisseur utilisé doit avoir sa clé
    const cles = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", voyage: "VOYAGE_API_KEY" } as const;
    for (const fournisseur of [env.LLM_PROVIDER, env.EMBEDDING_PROVIDER]) {
      if (fournisseur === "transformers") continue; // modèle local : pas de clé
      const cle = cles[fournisseur];
      if (!env[cle]) {
        ctx.addIssue({ code: "custom", path: [cle], message: `clé requise, car le fournisseur ${fournisseur} est utilisé` });
      }
    }
  });

export type Config = z.infer<typeof Schema>;

const resultat = Schema.safeParse(process.env);
if (!resultat.success) {
  console.error("Configuration invalide dans .env :\n" + z.prettifyError(resultat.error));
  process.exit(1);
}

export const config: Config = resultat.data;
