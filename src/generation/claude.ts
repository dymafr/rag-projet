// Répondre avec Claude : les passages partent en blocs search_result, et Claude cite lui-même ses sources.
// Chaque morceau de la réponse qui s'appuie sur un passage arrive avec sa citation : le passage et le texte cité
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Resultat } from "../recherche/vectorielle.ts";
import type { Citation, Generation, Morceau } from "./generateur.ts";
import { finDuMessage, type PromptAugmente } from "./prompt.ts";
import { ReponseRhea, type DemandeJson } from "./structure.ts";

// La réflexion, active d'office sur certains modèles, compte dans cette limite, comme le texte de la réponse
const MAX_TOKENS = 4096;

// 1. Un passage devient un bloc search_result. Claude cite des blocs de texte entiers :
// un bloc par paragraphe donne des citations plus précises qu'un seul bloc pour tout le passage
export function blocDeRecherche(passage: Resultat): Anthropic.SearchResultBlockParam {
  const paragraphes = passage.texte.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return {
    type: "search_result",
    source: passage.id,
    title: passage.titres.join(" > ") || passage.id,
    content: paragraphes.map((text) => ({ type: "text" as const, text })),
    citations: { enabled: true }, // désactivées par défaut
  };
}

// 2. La réponse arrive en plusieurs blocs de texte. On les recolle, en ajoutant [n] après chaque bloc qui cite
// le passage n. search_result_index compte, à partir de 0, tous les blocs search_result de la requête : ici, nos
// passages sont les seuls, dans l'ordre. On garde aussi les citations, pour les afficher
export function lireReponse(blocs: Anthropic.ContentBlock[]) {
  let texte = "";
  const citations: Citation[] = [];
  for (const bloc of blocs) {
    if (bloc.type !== "text") continue; // un bloc de réflexion peut précéder le texte
    const numeros = new Set<number>();
    for (const citation of bloc.citations ?? []) {
      if (citation.type !== "search_result_location") continue;
      numeros.add(citation.search_result_index + 1);
      citations.push({ numero: citation.search_result_index + 1, texteCite: citation.cited_text });
    }
    texte += bloc.text + [...numeros].map((n) => `[${n}]`).join("");
  }
  return { texte, citations };
}

function usageDe({ input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens }: Anthropic.Usage) {
  const enCache = cache_read_input_tokens ?? 0;
  return { entree: input_tokens + (cache_creation_input_tokens ?? 0) + enCache, enCache, sortie: output_tokens };
}

// 3. L'appel : le prompt système, puis un seul message avec les blocs des passages, la date du jour et la question.
// En JSON (leçon 5), Claude refuse les citations natives (erreur 400) : les passages partent alors en texte,
// numérotés comme pour OpenAI, et output_config donne le schéma à suivre
export async function repondreAvecClaude(client: Anthropic, modele: string, prompt: PromptAugmente, json?: DemandeJson): Promise<Generation> {
  const contenu: Anthropic.ContentBlockParam[] = json
    ? [{ type: "text", text: json.consigne ? `${prompt.utilisateur}\n\n${json.consigne}` : prompt.utilisateur }]
    : [...prompt.passages.map(blocDeRecherche), { type: "text", text: finDuMessage(prompt.question, prompt.date) }];
  const reponse = await client.messages.create({
    model: modele,
    max_tokens: MAX_TOKENS,
    system: prompt.systeme,
    messages: [{ role: "user", content: contenu }],
    ...(json && { output_config: { format: zodOutputFormat(ReponseRhea) } }),
  });
  // Un refus de sécurité ou une réponse coupée ne doit pas passer pour une réponse complète
  if (reponse.stop_reason !== "end_turn") {
    const detail = reponse.stop_reason === "refusal" ? ` (${reponse.stop_details?.explanation ?? "sans explication"})` : "";
    throw new Error(`Réponse interrompue : ${reponse.stop_reason}${detail}`);
  }
  const { texte, citations } = lireReponse(reponse.content);
  return { texte, citations, usage: usageDe(reponse.usage) };
}

// 4. En flux (leçon 8) : la même requête, en flux. Les morceaux de texte arrivent au fil de l'écriture, et chaque
// citation dès qu'elle est prête. Comme lireReponse, on ajoute [n] à la fin de chaque bloc de texte qui cite le passage n
export async function* streamerAvecClaude(client: Anthropic, modele: string, prompt: PromptAugmente, signal?: AbortSignal): AsyncGenerator<Morceau> {
  const contenu: Anthropic.ContentBlockParam[] = [...prompt.passages.map(blocDeRecherche), { type: "text", text: finDuMessage(prompt.question, prompt.date) }];
  const flux = client.messages.stream(
    { model: modele, max_tokens: MAX_TOKENS, system: prompt.systeme, messages: [{ role: "user", content: contenu }] },
    { signal },
  );
  const numerosDuBloc = new Set<number>();
  for await (const evenement of flux) {
    if (evenement.type === "content_block_delta" && evenement.delta.type === "text_delta") {
      yield { type: "texte", texte: evenement.delta.text };
    } else if (evenement.type === "content_block_delta" && evenement.delta.type === "citations_delta") {
      const citation = evenement.delta.citation;
      if (citation.type !== "search_result_location") continue;
      numerosDuBloc.add(citation.search_result_index + 1);
      yield { type: "citation", citation: { numero: citation.search_result_index + 1, texteCite: citation.cited_text } };
    } else if (evenement.type === "content_block_stop" && numerosDuBloc.size > 0) {
      yield { type: "texte", texte: [...numerosDuBloc].map((n) => `[${n}]`).join("") };
      numerosDuBloc.clear();
    }
  }
  // Le message complet, rassemblé par le SDK : les mêmes contrôles qu'en mode simple
  const message = await flux.finalMessage();
  if (message.stop_reason !== "end_turn") {
    const detail = message.stop_reason === "refusal" ? ` (${message.stop_details?.explanation ?? "sans explication"})` : "";
    throw new Error(`Réponse interrompue : ${message.stop_reason}${detail}`);
  }
  yield { type: "fin", usage: usageDe(message.usage) };
}
