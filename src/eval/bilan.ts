// Le bilan d'une évaluation : toutes les mesures des leçons précédentes, calculées à partir des fichiers d'une
// exécution (réponses, verdicts du juge, citations), sans rappeler ni la base ni le LLM. Gardé en JSON, il sert
// de ligne de base : la référence à laquelle on compare chaque changement de Rhéa
import { z } from "zod";
import { type Cas, tableauAbstention } from "./abstention.ts";
import type { FichierDeCitations } from "./citations.ts";
import type { QuestionDeReference } from "./jeu.ts";
import type { Critere, Jugements } from "./juge.ts";
import { mesurerRecuperation, moyennes } from "./recuperation.ts";
import { empreinte, type Enregistrement } from "./reponses.ts";
import { mcNemar } from "./statistiques.ts";

export function faireLeBilan(jeu: QuestionDeReference[], enregistrement: Enregistrement, jugements: Jugements, citations: FichierDeCitations) {
  const parId = new Map(jeu.map((q) => [q.id, q]));
  // Un verdict ne vaut que pour le texte qu'il a jugé ; un résultat de citations aussi
  const verdict = (id: string, critere: Critere, texte: string) =>
    jugements.jugements.find((j) => j.id === id && j.critere === critere && j.empreinte === empreinte(texte))?.verdict ?? null;

  const questions = enregistrement.reponses.map((r) => {
    const q = parId.get(r.id);
    if (!q) throw new Error(`${r.id} n'est plus dans le jeu d'évaluation : relancez l'évaluation complète (npm run eval)`);
    const repondu = r.abstention === null;
    const c = citations.resultats.find((x) => x.id === r.id && x.empreinte === empreinte(r.texte));
    const exactitude = repondu ? verdict(r.id, "exactitude", r.texte) : null;
    return {
      id: r.id,
      categorie: q.categorie,
      origine: q.origine,
      abstention: r.abstention,
      // Recalculées à partir des passages enregistrés : les mêmes que npm run eval:recherche, pour le k de l'exécution
      recuperation: q.categorie === "couverte" ? mesurerRecuperation(r.trouves.map((t) => t.id), q.passages, enregistrement.k) : null,
      fidelite: repondu ? verdict(r.id, "fidelite", r.texte) : null,
      pertinence: repondu ? verdict(r.id, "pertinence", r.texte) : null,
      exactitude,
      // nonEtablies : les phrases qui citent un passage et que ce passage n'établit pas (une phrase sans citation n'y est pas)
      citations: repondu && c
        ? { rappel: c.rappel, precision: c.precision, sourceAttendue: c.sourceAttendue, nonEtablies: c.phrases.filter((p) => p.appuyee === false).length }
        : null,
      // Réussie : une réponse exacte à une question couverte, une abstention sur les autres
      reussie: q.categorie === "couverte" ? repondu && exactitude === true : !repondu,
    };
  });

  const compter = (valeurs: (boolean | null)[]) => {
    const lues = valeurs.filter((v) => v !== null);
    return { oui: lues.filter(Boolean).length, n: lues.length };
  };
  const moyenne = (valeurs: (number | null)[]) => {
    const lues = valeurs.filter((v): v is number => v !== null);
    return lues.length === 0 ? null : lues.reduce((a, b) => a + b, 0) / lues.length;
  };
  const recuperees = questions.flatMap((q) => (q.recuperation ? [q.recuperation] : []));
  const cas: Cas[] = questions.map((q) => ({ id: q.id, categorie: q.categorie, abstention: q.abstention, exacte: q.exactitude }));
  return {
    configuration: {
      date: enregistrement.date,
      jeu: empreinte(JSON.stringify(jeu)), // un autre jeu d'évaluation donnerait d'autres chiffres
      llm: enregistrement.llm,
      embeddings: enregistrement.embeddings,
      prompt: enregistrement.prompt,
      k: enregistrement.k,
      budget: enregistrement.budget,
      juge: jugements.juge,
      consignes: jugements.consignes,
    },
    recuperation: { n: recuperees.length, ...moyennes(recuperees) },
    generation: {
      fidelite: compter(questions.map((q) => q.fidelite)),
      pertinence: compter(questions.map((q) => q.pertinence)),
      exactitude: compter(questions.map((q) => q.exactitude)),
    },
    citations: {
      rappel: moyenne(questions.map((q) => q.citations?.rappel ?? null)),
      precision: moyenne(questions.map((q) => q.citations?.precision ?? null)),
      sourceAttendue: compter(questions.map((q) => q.citations?.sourceAttendue ?? null)),
    },
    abstention: tableauAbstention(cas),
    reussite: compter(questions.map((q) => q.reussie)),
    // Les questions générées par un LLM sont souvent plus faciles que les vraies : on compare les deux origines
    reussiteParOrigine: {
      ecrite: compter(questions.filter((q) => q.origine === "ecrite").map((q) => q.reussie)),
      synthetique: compter(questions.filter((q) => q.origine === "synthetique").map((q) => q.reussie)),
    },
    questions,
  };
}
export type Bilan = ReturnType<typeof faireLeBilan>;

// Ce que la comparaison relit d'un bilan enregistré (la ligne de base). Il est validé : un champ renommé ou un fichier
// abîmé arrête la comparaison, au lieu de la fausser sans rien dire
const Compte = z.object({ oui: z.number(), n: z.number() });
export const BilanRelu = z.object({
  configuration: z.object({ date: z.string(), jeu: z.string().optional(), k: z.number(), budget: z.number() }),
  recuperation: z.object({ succes: z.number(), rangReciproque: z.number(), ndcg: z.number() }),
  generation: z.object({ fidelite: Compte, exactitude: Compte }),
  reussite: Compte,
  questions: z.array(z.object({ id: z.string(), reussie: z.boolean() })),
});
export type BilanRelu = z.infer<typeof BilanRelu>;

// Comparer deux bilans question par question : celles qui passent de ratée à réussie (gagnées) ou l'inverse
// (perdues), et la probabilité qu'un tel écart vienne du hasard (test de McNemar)
export function comparerBilans(base: BilanRelu, actuel: BilanRelu) {
  const avant = new Map(base.questions.map((q) => [q.id, q.reussie]));
  const communes = actuel.questions.filter((q) => avant.has(q.id));
  const gagnees = communes.filter((q) => q.reussie && !avant.get(q.id)).map((q) => q.id);
  const perdues = communes.filter((q) => !q.reussie && avant.get(q.id)).map((q) => q.id);
  return { gagnees, perdues, p: mcNemar(gagnees.length, perdues.length) };
}
