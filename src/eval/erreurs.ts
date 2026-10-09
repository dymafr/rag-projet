// Analyser les erreurs : pour chaque question à problème, l'étape du pipeline où il apparaît en premier. Une réponse
// fausse peut venir de la recherche (le bon passage n'a pas été trouvé), d'une abstention, du prompt (trouvé mais
// écarté faute de place) ou du LLM (il avait le bon passage). Corriger le LLM ne sert à rien si le passage ne lui
// parvient jamais
import type { Bilan } from "./bilan.ts";
import type { QuestionDeReference } from "./jeu.ts";
import type { ReponseEnregistree } from "./reponses.ts";

export const ETAPES = {
  recuperation: "Récupération : le passage qui répond n'est pas parmi les passages trouvés",
  abstention: "Abstention à tort : le passage qui répond a été trouvé, et Rhéa s'est abstenue",
  budget: "Budget du prompt : le passage qui répond a été trouvé, puis écarté faute de place",
  generation: "Génération : le passage qui répond était dans le prompt, la réponse est fausse, infidèle ou à côté",
  citations: "Citations : la réponse est juste, mais une phrase qui cite n'est pas établie par ses passages",
  "reponse-a-tort": "Réponse à tort : Rhéa a répondu à une question hors corpus ou interdite",
} as const;
export type Etape = keyof typeof ETAPES;

type QuestionDuBilan = Bilan["questions"][number];

export function classer(q: QuestionDeReference, r: ReponseEnregistree, b: QuestionDuBilan): Etape | null {
  if (q.categorie !== "couverte") return r.abstention === null ? "reponse-a-tort" : null;
  const probleme =
    !b.reussie || b.fidelite === false || b.pertinence === false || b.citations?.sourceAttendue === false || (b.citations?.nonEtablies ?? 0) > 0;
  if (!probleme) return null;
  // On suit le chemin d'un passage qui répond (noté 2) : trouvé par la recherche, puis envoyé au LLM
  const repondent = Object.keys(q.passages).filter((id) => q.passages[id] === 2);
  if (!r.trouves.some((t) => repondent.includes(t.id))) return "recuperation";
  // Arrêtée avant le LLM (score sous le seuil, ou budget vide), Rhéa n'a envoyé aucun passage : ce n'est pas le budget
  if (r.abstention === "avant-llm") return "abstention";
  if (!r.passages.some((p) => repondent.includes(p.id))) return "budget";
  if (r.abstention !== null) return "abstention";
  if (!b.reussie || b.fidelite === false || b.pertinence === false) return "generation";
  return "citations";
}

// Les erreurs regroupées par étape : d'abord celle qui fait rater le plus de questions (la gravité), puis, à égalité,
// la plus fréquente. C'est par la première qu'il faut commencer
export function prioriser(erreurs: { id: string; etape: Etape; ratee: boolean }[]) {
  const groupes = Object.entries(Object.groupBy(erreurs, (e) => e.etape)) as [Etape, typeof erreurs][];
  return groupes
    .map(([etape, liste]) => ({ etape, questions: liste.map((e) => e.id), ratees: liste.filter((e) => e.ratee).length }))
    .sort((a, b) => b.ratees - a.ratees || b.questions.length - a.questions.length);
}
