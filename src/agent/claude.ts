// L'agent avec Claude (API Messages). Un outil se déclare avec input_schema ; une demande d'appel revient en bloc
// tool_use, et son résultat repart en bloc tool_result, dans un message user, relié à la demande par tool_use_id.
// Les passages d'une recherche partent en blocs search_result, comme au chapitre 7 : Claude les cite lui-même
import type Anthropic from "@anthropic-ai/sdk";
import { blocDeRecherche, usageDe } from "../generation/claude.ts";
import type { AppelOutil, LlmAgent, Message } from "./llm-agent.ts";
import { schemaJson, type Outil } from "./outil.ts";

const MAX_TOKENS = 4096; // voir generation/claude.ts

export const outilClaude = (outil: Outil): Anthropic.Tool => ({
  name: outil.nom,
  description: outil.description,
  input_schema: schemaJson(outil) as Anthropic.Tool.InputSchema,
});

// Un résultat d'outil : les passages s'il y en a, sinon le texte ; is_error dit à Claude que l'appel a échoué
const blocDeResultat = (m: Extract<Message, { role: "outil" }>): Anthropic.ToolResultBlockParam => ({
  type: "tool_result",
  tool_use_id: m.id,
  content: m.passages?.length ? m.passages.map(blocDeRecherche) : m.texte,
  ...(m.erreur && { is_error: true }),
});

// La conversation commune, traduite en messages de l'API. Claude veut tous les résultats d'un même tour dans un seul
// message user, juste après sa demande
export function versClaude(messages: Message[]): Anthropic.MessageParam[] {
  const liste: Anthropic.MessageParam[] = [];
  for (const m of messages) {
    if (m.role === "utilisateur") {
      // Après des résultats d'outils (la consigne du dernier tour), le texte rejoint leur message, à la suite
      const precedent = liste.at(-1);
      if (precedent?.role === "user" && Array.isArray(precedent.content)) precedent.content.push({ type: "text", text: m.texte });
      else liste.push({ role: "user", content: m.texte });
    } else if (m.role === "assistant") {
      const contenu = (m.brut as Anthropic.ContentBlockParam[] | undefined) ?? [
        ...(m.texte ? [{ type: "text" as const, text: m.texte }] : []),
        ...m.appels.map((a) => ({ type: "tool_use" as const, id: a.id, name: a.nom, input: a.arguments })),
      ];
      liste.push({ role: "assistant", content: contenu });
    } else {
      const precedent = liste.at(-1);
      const resultats = precedent?.role === "user" && Array.isArray(precedent.content) ? precedent.content : null;
      if (resultats?.every((b) => b.type === "tool_result")) resultats.push(blocDeResultat(m));
      else liste.push({ role: "user", content: [blocDeResultat(m)] });
    }
  }
  return liste;
}

// La réponse : le texte, avec la source de chaque passage cité entre crochets à la fin du bloc qui le cite (le même
// format que les autres fournisseurs ; si Claude l'écrit aussi juste à côté, elle ne reste qu'une fois), et les demandes d'appel
export function lireReponseAgent(blocs: Anthropic.ContentBlock[]): { texte: string; appels: AppelOutil[] } {
  let texte = "";
  const appels: AppelOutil[] = [];
  for (const bloc of blocs) {
    if (bloc.type === "tool_use") appels.push({ id: bloc.id, nom: bloc.name, arguments: bloc.input });
    if (bloc.type !== "text") continue; // un bloc de réflexion peut précéder le texte
    const sources = new Set((bloc.citations ?? []).flatMap((c) => (c.type === "search_result_location" ? [c.source] : [])));
    texte += bloc.text + [...sources].map((s) => `[${s}]`).join("");
  }
  return { texte: texte.replace(/(\[[^\]\s]+\])[ \t]*\1/g, "$1"), appels };
}

export function agentClaude(client: Anthropic, modele: string): LlmAgent {
  return async (systeme, messages, outils, options = {}) => {
    const reponse = await client.messages.create({
      model: modele,
      max_tokens: MAX_TOKENS,
      system: systeme,
      messages: versClaude(messages),
      tools: outils.map(outilClaude), // toujours déclarés, comme aux tours précédents : c'est tool_choice qui interdit l'appel
      ...(options.sansOutil && { tool_choice: { type: "none" as const } }),
    });
    // end_turn : une réponse ; tool_use : des demandes d'appel. Le reste (refus, limite de tokens) n'est ni l'un ni l'autre
    if (reponse.stop_reason !== "end_turn" && reponse.stop_reason !== "tool_use") {
      const detail = reponse.stop_reason === "refusal" ? ` (${reponse.stop_details?.explanation ?? "sans explication"})` : "";
      throw new Error(`Réponse interrompue : ${reponse.stop_reason}${detail}`);
    }
    return { ...lireReponseAgent(reponse.content), usage: usageDe(reponse.usage), brut: reponse.content };
  };
}
