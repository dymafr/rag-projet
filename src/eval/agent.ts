// Ce que npm run eval:agent enregistre pour chaque question, et le bilan que npm run eval:agent:juger en tire : une
// question réussie est, comme au chapitre 8, une réponse exacte à une question couverte, ou un refus sur les autres
import type { Usage } from "../llm.ts";
import { mcNemar } from "./statistiques.ts";

export type TraceAgent = {
  id: string;
  categorie: string;
  question: string;
  appels: { id: string; nom: string; arguments: unknown }[];
  resultats: string[]; // le texte rendu par chaque appel d'outil : ce que le LLM a lu, que le juge lira aussi
  tours: number;
  dernierTour: boolean; // la boucle a dû retirer les outils
  succes: boolean | null; // couverte : un passage de pertinence 2 parmi les passages vus ; sinon null
  documents: string[]; // les documents vus : ceux des passages rendus, ou des fichiers lus et des lignes trouvées
  succesDocument: boolean | null; // couverte : un document qui contient un passage de pertinence 2 parmi eux
  cites: string[];
  inventees: string[];
  tokens: number;
  secondes: number;
  reponse: string;
  // Chapitre 11 : le détail des tokens, pour en calculer le coût, et les appels de recherche facturés à l'unité (file_search)
  usage?: Usage;
  recherchesFacturees?: number;
};

// systeme : chapitre 11, le système comparé (maison, langchain, file-search) ; absent : l'agent du chapitre 10
export type FichierAgent = { date: string; prompt: string; toursMax: number; llm?: string; systeme?: string; traces: TraceAgent[] };

// Les verdicts du juge pour une question : exactitude et fidélité pour une question couverte, refus pour les autres
export type VerdictsAgent = { id: string; categorie: string; exactitude?: boolean | null; fidelite?: boolean | null; refus?: boolean | null };

export const reussie = (v: VerdictsAgent) => (v.categorie === "couverte" ? v.exactitude === true : v.refus === true);

// Le bilan, et la comparaison question par question avec une autre évaluation (la fin du chapitre 9) : gagnées,
// perdues, et la probabilité d'un tel écart par hasard (McNemar, chapitre 8)
export function bilanAgent(verdicts: VerdictsAgent[], reference?: Map<string, boolean>) {
  const couvertes = verdicts.filter((v) => v.categorie === "couverte");
  const autres = verdicts.filter((v) => v.categorie !== "couverte");
  const compte = (liste: VerdictsAgent[], f: (v: VerdictsAgent) => boolean) => liste.filter(f).length;
  const bilan = {
    reussies: compte(verdicts, reussie),
    total: verdicts.length,
    exactes: compte(couvertes, (v) => v.exactitude === true),
    couvertes: couvertes.length,
    fideles: compte(couvertes, (v) => v.fidelite === true),
    refusJustes: compte(autres, (v) => v.refus === true),
    autres: autres.length,
    comparaison: null as null | { gagnees: string[]; perdues: string[]; p: number },
  };
  if (reference) {
    const gagnees = verdicts.filter((v) => reussie(v) && reference.get(v.id) === false).map((v) => v.id);
    const perdues = verdicts.filter((v) => !reussie(v) && reference.get(v.id) === true).map((v) => v.id);
    bilan.comparaison = { gagnees, perdues, p: mcNemar(gagnees.length, perdues.length) };
  }
  return bilan;
}
