// Envoyer un prompt au LLM choisi dans .env (Claude, OpenAI ou Ollama) et lire sa réponse, avec les tokens consommés.
// Le prompt arrive en deux parties : un début qui se répète d'un appel à l'autre (mis en cache quand le fournisseur
// le permet), puis la fin, propre à chaque appel
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { config } from "./config.ts";
import { conseilOllama, ollama } from "./ollama.ts";

export type Usage = { entree: number; enCache: number; sortie: number }; // enCache : tokens d'entrée relus dans le cache
export type Llm = (debut: string, fin: string) => Promise<{ texte: string; usage: Usage }>;

const MAX_TOKENS = 1024; // de quoi répondre, même si le modèle réfléchit avant

// Claude : le bloc marqué cache_control est gardé quelques minutes ; relu par l'appel suivant, il coûte bien moins cher
function appelAnthropic(modele: string): Llm {
  const client = new Anthropic();
  return async (debut, fin) => {
    const reponse = await client.messages.create({
      model: modele,
      max_tokens: MAX_TOKENS,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: debut, cache_control: { type: "ephemeral" } },
            { type: "text", text: fin },
          ],
        },
      ],
    });
    const texte = reponse.content.flatMap((bloc) => (bloc.type === "text" ? [bloc.text] : [])).join("");
    const { input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens } = reponse.usage;
    const enCache = cache_read_input_tokens ?? 0;
    return { texte, usage: { entree: input_tokens + (cache_creation_input_tokens ?? 0) + enCache, enCache, sortie: output_tokens } };
  };
}

// OpenAI : mise en cache par défaut, mais les modèles récents n'écrivent d'eux-mêmes que le prompt entier,
// qui change à chaque appel : on marque donc la fin du document, comme cache_control chez Claude
function appelOpenAI(modele: string): Llm {
  const client = new OpenAI();
  return async (debut, fin) => {
    const document = { type: "input_text" as const, text: debut, prompt_cache_breakpoint: { mode: "explicit" as const } };
    const input = [{ role: "user" as const, content: [document] }, { role: "user" as const, content: fin }];
    const reponse = await client.responses.create({ model: modele, input, max_output_tokens: MAX_TOKENS });
    const usage = reponse.usage;
    return {
      texte: reponse.output_text,
      usage: { entree: usage?.input_tokens ?? 0, enCache: usage?.input_tokens_details?.cached_tokens ?? 0, sortie: usage?.output_tokens ?? 0 },
    };
  };
}

// Ollama : le modèle tourne en local, sans coût par token. Comme pour les réponses de Rhéa (generateur.ts), température 0
// et pas de réflexion préalable : c'est plus rapide, et la même question reçoit presque toujours la même réponse, ce
// qu'on attend d'un juge (« presque » : le chapitre 8 mesure ces écarts)
function appelOllama(modele: string): Llm {
  return async (debut, fin) => {
    const reponse = await ollama.chat.completions
      .create({
        model: modele,
        messages: [{ role: "user", content: `${debut}\n\n${fin}` }],
        max_tokens: MAX_TOKENS,
        temperature: 0,
        reasoning_effort: "none",
      })
      .catch(conseilOllama);
    return {
      texte: reponse.choices[0]?.message.content ?? "",
      usage: { entree: reponse.usage?.prompt_tokens ?? 0, enCache: 0, sortie: reponse.usage?.completion_tokens ?? 0 },
    };
  };
}

const APPELS = { anthropic: appelAnthropic, openai: appelOpenAI, ollama: appelOllama };

// modele : celui de .env par défaut ; le juge d'évaluation peut en prendre un autre, chez le même fournisseur
export const creerLlm = (modele = config.LLM_MODEL): Llm => APPELS[config.LLM_PROVIDER](modele);
