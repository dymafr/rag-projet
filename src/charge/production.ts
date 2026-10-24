// Les LLM de Rhéa en production (chapitre 14, leçon 8) : celui de .env, derrière son disjoncteur, avec le repli de .env
// s'il y en a un (LLM_REPLI_PROVIDER, LLM_REPLI_MODEL). Les disjoncteurs vivent aussi longtemps que le processus : ils
// se souviennent des échecs d'une question à l'autre, c'est tout leur intérêt. Le juge d'évaluation n'en a pas : une
// évaluation qui changerait de juge en silence ne mesurerait plus la même chose
import { creerLlmAgent, type LlmAgent } from "../agent/llm-agent.ts";
import { config } from "../config.ts";
import { creerLlm, type Llm } from "../llm.ts";
import type { Modele } from "../trace/trace.ts";
import { Disjoncteur } from "./disjoncteur.ts";
import { agentAvecRepli, llmAvecRepli, repliPour } from "./repli.ts";

const disjoncteurs = new Map<string, Disjoncteur>();
export const disjoncteurPour = (modele: Modele) => {
  const nom = `${modele.fournisseur} ${modele.modele}`;
  if (!disjoncteurs.has(nom)) disjoncteurs.set(nom, new Disjoncteur(nom));
  return disjoncteurs.get(nom)!;
};
// L'état de chaque disjoncteur, pour la route de santé et l'interface
export const etatDesDisjoncteurs = () => [...disjoncteurs.values()].map((d) => ({ nom: d.nom, etat: d.etat }));

const PRINCIPAL: Modele = { fournisseur: config.LLM_PROVIDER, modele: config.LLM_MODEL };
const { LLM_REPLI_PROVIDER: fournisseurDeRepli, LLM_REPLI_MODEL: modeleDeRepli } = config;
const REPLI: Modele | undefined = fournisseurDeRepli && modeleDeRepli ? { fournisseur: fournisseurDeRepli, modele: modeleDeRepli } : undefined;
// Leçon 5 : le LLM des étapes de la recherche, s'il n'est pas celui qui rédige (LLM_RECHERCHE_PROVIDER, LLM_RECHERCHE_MODEL)
const { LLM_RECHERCHE_PROVIDER: fournisseurDeRecherche, LLM_RECHERCHE_MODEL: modeleDeRecherche } = config;
const RECHERCHE: Modele = fournisseurDeRecherche && modeleDeRecherche ? { fournisseur: fournisseurDeRecherche, modele: modeleDeRecherche } : PRINCIPAL;
export const modelesDeProduction = { principal: PRINCIPAL, recherche: RECHERCHE, repli: REPLI ?? null };

// Une évaluation mesure un modèle, et un seul : sans disjoncteur ni repli (evaluer-production.ts l'appelle au début). Sinon,
// une panne ferait répondre le repli sous le nom du principal, et un disjoncteur ouvert ferait échouer des questions sans
// même les poser
let sansRepli = false;
export const pourEvaluer = () => void (sansRepli = true);

// Le LLM de l'agent, pour une question (le repli bascule pour toute la question)
export function llmAgentDeProduction(): { llm: LlmAgent; modele: () => Modele } {
  if (sansRepli) return { llm: creerLlmAgent(), modele: () => PRINCIPAL };
  const principal = { appel: creerLlmAgent(), modele: PRINCIPAL, disjoncteur: disjoncteurPour(PRINCIPAL) };
  const repli = REPLI && { appel: creerLlmAgent(REPLI.modele, fournisseurDeRepli), modele: REPLI, disjoncteur: disjoncteurPour(REPLI) };
  return agentAvecRepli(principal, repli);
}

// Le LLM simple : le SQL, et (llmDeRecherche) les étapes de la recherche, avec leur modèle à elles. Leur repli : chez un
// autre fournisseur (repliPour)
export function llmDeProduction(modele: Modele = PRINCIPAL): Llm {
  if (sansRepli) return creerLlm(modele.modele, modele.fournisseur as typeof config.LLM_PROVIDER);
  const principal = { appel: creerLlm(modele.modele, modele.fournisseur as typeof config.LLM_PROVIDER), modele, disjoncteur: disjoncteurPour(modele) };
  const secours = repliPour(modele, REPLI, PRINCIPAL);
  const repli = secours && { appel: creerLlm(secours.modele, secours.fournisseur as typeof config.LLM_PROVIDER), modele: secours, disjoncteur: disjoncteurPour(secours) };
  return llmAvecRepli(principal, repli);
}
export const llmDeRecherche = () => llmDeProduction(RECHERCHE);
