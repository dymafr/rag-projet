// Les métriques de récupération : les passages trouvés par la recherche, dans leur ordre, comparés aux passages
// attendus du jeu d'évaluation. Un passage est pertinent s'il a une note (1 ou 2) ; le nDCG tient compte de la note,
// et le succès@k ne compte que les passages qui répondent (note 2)
export type Notes = Record<string, number>;

const pertinent = (notes: Notes, id: string) => Object.hasOwn(notes, id);

// Succès@k : 1 si au moins un passage qui répond (noté 2) est dans les k premiers résultats, 0 sinon. Plusieurs passages
// disent souvent la même chose (la FAQ et la politique) : un seul suffit au LLM, ce que le rappel ne voit pas
export function succes(trouves: string[], notes: Notes, k: number): number {
  return trouves.slice(0, k).some((id) => pertinent(notes, id) && notes[id] === 2) ? 1 : 0;
}

// Rappel@k : la part des passages pertinents que la recherche a trouvés dans ses k premiers résultats
export function rappel(trouves: string[], notes: Notes, k: number): number {
  const pertinents = Object.keys(notes);
  const premiers = trouves.slice(0, k);
  return pertinents.filter((id) => premiers.includes(id)).length / pertinents.length;
}

// Précision@k : la part des k premiers résultats qui sont pertinents (une recherche qui rend moins de k résultats
// est divisée par k quand même : les places vides comptent comme des résultats inutiles)
export function precision(trouves: string[], notes: Notes, k: number): number {
  return trouves.slice(0, k).filter((id) => pertinent(notes, id)).length / k;
}

// Rang réciproque : 1 si le premier résultat est pertinent, 1/2 si c'est le deuxième, 1/3 le troisième…
// et 0 si aucun des k premiers ne l'est. Sa moyenne sur toutes les questions s'appelle le MRR (mean reciprocal rank)
export function rangReciproque(trouves: string[], notes: Notes, k: number): number {
  const rang = trouves.slice(0, k).findIndex((id) => pertinent(notes, id));
  return rang === -1 ? 0 : 1 / (rang + 1);
}

// nDCG@k (normalized discounted cumulative gain) : chaque passage trouvé rapporte sa note, d'autant moins qu'il
// est classé bas (la note est divisée par log2(rang + 1)). Le total est divisé par celui du meilleur classement
// possible, les passages attendus rangés par note décroissante : 1 pour un classement parfait, 0 si rien n'est trouvé
export function ndcg(trouves: string[], notes: Notes, k: number): number {
  const dcg = (gains: number[]) => gains.slice(0, k).reduce((total, gain, i) => total + gain / Math.log2(i + 2), 0);
  const ideal = dcg(Object.values(notes).sort((a, b) => b - a));
  return dcg(trouves.map((id) => (pertinent(notes, id) ? notes[id] : 0))) / ideal;
}

export function mesurerRecuperation(trouves: string[], notes: Notes, k: number) {
  return {
    succes: succes(trouves, notes, k),
    rappel: rappel(trouves, notes, k),
    precision: precision(trouves, notes, k),
    rangReciproque: rangReciproque(trouves, notes, k),
    ndcg: ndcg(trouves, notes, k),
  };
}
export type MesuresRecuperation = ReturnType<typeof mesurerRecuperation>;

// La moyenne de chaque métrique sur un ensemble de questions ; celle du rang réciproque est le MRR
export function moyennes(mesures: MesuresRecuperation[]): MesuresRecuperation {
  const moyenne = (cle: keyof MesuresRecuperation) => mesures.reduce((total, m) => total + m[cle], 0) / mesures.length;
  return { succes: moyenne("succes"), rappel: moyenne("rappel"), precision: moyenne("precision"), rangReciproque: moyenne("rangReciproque"), ndcg: moyenne("ndcg") };
}
