// Le repli de fournisseur (chapitre 14, leçon 8) : quand le LLM principal ne répond pas (panne, surcharge, limite de débit,
// disjoncteur ouvert), un autre fournisseur prend le relais, pour cette question et les suivantes, le temps que le
// principal revienne. Rhéa parle aux LLM dans un format commun (llm-agent.ts) : changer de fournisseur au milieu d'une
// question est possible, à une condition. Une réponse garde ce que son API exige de retrouver au tour suivant (brut : la
// réflexion du modèle, chiffrée chez OpenAI) ; un autre fournisseur ne saurait pas le lire. Au premier repli, on le retire
// de la conversation, et la question finit chez le repli.
// Le repli ne vaut que pour les LLM. Les embeddings ne se remplacent pas ainsi : les vecteurs d'un autre modèle ne se
// comparent pas à ceux de l'index (sauf entre modèles d'une même famille qui partagent leur espace, comme voyage-4)
import type { LlmAgent, Message } from "../agent/llm-agent.ts";
import type { Llm } from "../llm.ts";
import { noter, type Modele } from "../trace/trace.ts";
import { type Disjoncteur, duFournisseur } from "./disjoncteur.ts";

export type Fournisseur<F> = { appel: F; modele: Modele; disjoncteur: Disjoncteur };

const nomDe = (m: Modele) => `${m.fournisseur} ${m.modele}`;
const sansBrut = (messages: Message[]): Message[] => messages.map((m) => (m.role === "assistant" ? { ...m, brut: undefined } : m));

function noterRepli(principal: Modele, repli: Modele, erreur: unknown) {
  const raison = erreur instanceof Error ? erreur.message.split("\n")[0].slice(0, 200) : String(erreur);
  noter("repli", "Repli de fournisseur", { resume: `${nomDe(principal)} indisponible : ${nomDe(repli)} prend le relais`, details: { principal, repli, raison } });
}

// Le LLM de l'agent avec repli. bascule : une fois passée au repli, la question y reste (sa conversation a perdu le brut
// du principal). Un fournisseur à créer par question : assemblerRhea le fait
export function agentAvecRepli(principal: Fournisseur<LlmAgent>, repli?: Fournisseur<LlmAgent>): { llm: LlmAgent; modele: () => Modele } {
  let bascule = false;
  const llm: LlmAgent = async (systeme, messages, outils, options) => {
    if (!bascule) {
      try {
        return await principal.disjoncteur.appeler(() => principal.appel(systeme, messages, outils, options));
      } catch (erreur) {
        if (!repli || !duFournisseur(erreur)) throw erreur;
        noterRepli(principal.modele, repli.modele, erreur);
        bascule = true;
      }
    }
    return repli!.disjoncteur.appeler(() => repli!.appel(systeme, sansBrut(messages), outils, options));
  };
  return { llm, modele: () => (bascule && repli ? repli.modele : principal.modele) };
}

// Le repli d'un LLM est chez un autre fournisseur : une panne touche d'ordinaire tout un fournisseur. Celui de .env, s'il
// est ailleurs ; sinon, pour les étapes de la recherche (leçon 5), le LLM qui rédige, s'il est ailleurs, lui
export const repliPour = (modele: Modele, repli: Modele | undefined, principal: Modele): Modele | undefined =>
  [repli, principal].find((m) => m && m.fournisseur !== modele.fournisseur) ?? repli;

// Le LLM simple (condensation, filtres extraits, reclassement, SQL) avec repli : chaque appel est indépendant, rien à
// retirer. Le juge d'évaluation n'en a pas (production.ts)
export function llmAvecRepli(principal: Fournisseur<Llm>, repli?: Fournisseur<Llm>): Llm {
  return async (debut, fin) => {
    try {
      return await principal.disjoncteur.appeler(() => principal.appel(debut, fin));
    } catch (erreur) {
      if (!repli || !duFournisseur(erreur)) throw erreur;
      noterRepli(principal.modele, repli.modele, erreur);
      return repli.disjoncteur.appeler(() => repli.appel(debut, fin));
    }
  };
}
