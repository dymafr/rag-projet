// Diagnostiquer la récupération à partir des traces : pour chaque question couverte, où est tombé le premier passage
// qui répond (noté 2) ? Chaque cas appelle un remède différent, que les leçons suivantes mettent en place
import type { QuestionDeReference } from "./jeu.ts";
import { mesurerRecuperation, moyennes, type Notes } from "./recuperation.ts";
import { mcNemar } from "./statistiques.ts";
import type { FichierDeTraces } from "./traces.ts";

export const DIAGNOSTICS = {
  trouve: "trouvé", // dans les k premiers, avec peu de passages non pertinents devant lui
  noye: "noyé", // dans les k premiers, mais derrière plusieurs passages non pertinents : il arrive au LLM au milieu du bruit
  "mal-classe": "mal classé", // parmi les candidats, mais après le rang k : il n'arrive pas au LLM
  absent: "absent", // dans aucun des candidats : la recherche ne le voit pas
} as const;
export type Diagnostic = keyof typeof DIAGNOSTICS;

// Le nombre de passages non pertinents devant le premier passage qui répond à partir duquel on le dit noyé
export const BRUIT = 3;

export type Verdict = { diagnostic: Diagnostic; rang: number | null; devant: number }; // rang : à partir de 1

export function diagnostiquer(candidats: string[], notes: Notes, k: number, bruit = BRUIT): Verdict {
  const i = candidats.findIndex((id) => Object.hasOwn(notes, id) && notes[id] === 2);
  if (i === -1) return { diagnostic: "absent", rang: null, devant: 0 };
  // Devant lui, les passages sans note : ils ne répondent pas et n'aident pas (un passage noté 1 n'est pas du bruit)
  const devant = candidats.slice(0, i).filter((id) => !Object.hasOwn(notes, id)).length;
  if (i >= k) return { diagnostic: "mal-classe", rang: i + 1, devant };
  return { diagnostic: devant >= bruit ? "noye" : "trouve", rang: i + 1, devant };
}

// Le diagnostic et les mesures du chapitre 8 de chaque question couverte présente dans les traces
export function diagnostiquerTraces(fichier: FichierDeTraces, jeu: QuestionDeReference[], k: number) {
  const traces = new Map(fichier.traces.map((t) => [t.id, t]));
  return jeu.flatMap((q) => {
    const t = traces.get(q.id);
    if (q.categorie !== "couverte" || !t) return [];
    const candidats = t.candidats.map((c) => c.id);
    return [{ id: q.id, question: q.question, verdict: diagnostiquer(candidats, q.passages, k), mesures: mesurerRecuperation(candidats, q.passages, k) }];
  });
}
export type Ligne = ReturnType<typeof diagnostiquerTraces>[number];

// Comparer deux recherches sur les mêmes questions : les diagnostics qui changent, les moyennes avant et après, et les
// questions gagnées (aucun passage qui répond dans les k premiers avant, au moins un après) ou perdues (l'inverse)
export function comparerDiagnostics(avant: Ligne[], apres: Ligne[]) {
  const parId = new Map(avant.map((l) => [l.id, l]));
  const paires = apres.flatMap((l) => (parId.has(l.id) ? [{ avant: parId.get(l.id)!, apres: l }] : []));
  const changees = paires.filter((p) => p.avant.verdict.rang !== p.apres.verdict.rang || p.avant.verdict.diagnostic !== p.apres.verdict.diagnostic);
  const gagnees = paires.filter((p) => p.avant.mesures.succes === 0 && p.apres.mesures.succes === 1).map((p) => p.apres.id);
  const perdues = paires.filter((p) => p.avant.mesures.succes === 1 && p.apres.mesures.succes === 0).map((p) => p.apres.id);
  return {
    changees,
    moyennesAvant: moyennes(paires.map((p) => p.avant.mesures)),
    moyennesApres: moyennes(paires.map((p) => p.apres.mesures)),
    gagnees,
    perdues,
    p: mcNemar(gagnees.length, perdues.length),
  };
}
