// Diversité et budget du prompt. Les passages les plus proches de la question se ressemblent souvent entre eux : la FAQ,
// le guide et l'article de l'avenant disent la même chose, et occupent trois places du budget pour une seule information.
// MMR choisit des passages pertinents ET différents ; la fusion des voisins recolle deux morceaux d'un même texte
import { produitScalaire } from "../embeddings/similarite.ts";
import type { Resultat } from "./vectorielle.ts";

// 1. MMR (maximal marginal relevance) : on choisit les passages un par un. À chaque tour, chaque candidat reçoit
// lambda × sa pertinence, moins (1 − lambda) × sa plus forte similarité avec un passage déjà choisi (sa redondance).
// La pertinence vient du rang dans la liste reçue, de 1 pour le premier à 1/n pour le dernier : l'ordre de la recherche
// (hybride, transformée…) est respecté, alors que les scores, des similarités cosinus, ne le suivent pas toujours.
// lambda = 1 : la liste telle quelle ; plus il baisse, plus on écarte les redites.
// Les vecteurs sont normalisés : leur produit scalaire est leur similarité cosinus
export function mmr(candidats: (Resultat & { vecteur: number[] })[], k: number, lambda = 0.7): Resultat[] {
  const n = candidats.length;
  const pertinence = candidats.map((_, i) => (n - i) / n);
  // Avant le premier choix, aucune redondance (0) ; une similarité négative, rare, ne compte pas comme un bonus
  const redondance = candidats.map(() => 0);
  const restants = new Set(candidats.keys());
  const choisis: number[] = [];
  while (choisis.length < k && restants.size > 0) {
    // Le candidat qui a la plus haute valeur ; à valeur égale, le mieux classé (le premier rencontré)
    let meilleur = -1;
    let valeurMax = -Infinity;
    for (const i of restants) {
      const valeur = lambda * pertinence[i] - (1 - lambda) * redondance[i];
      if (valeur > valeurMax) [meilleur, valeurMax] = [i, valeur];
    }
    restants.delete(meilleur);
    choisis.push(meilleur);
    // Le nouveau choisi : chaque restant compare sa redondance à sa similarité avec lui
    for (const i of restants) redondance[i] = Math.max(redondance[i], produitScalaire(candidats[i].vecteur, candidats[meilleur].vecteur));
  }
  return choisis.map((i) => {
    const { vecteur, ...passage } = candidats[i];
    return passage;
  });
}

// 2. Fusionner les voisins : deux passages qui se suivent dans le même document (POL-CA-01#16 et POL-CA-01#17) ne font
// plus qu'un, dans l'ordre du document. Un tableau coupé en deux se relit en entier, et une seule balise de passage
// remplace deux. Le passage fusionné garde l'identifiant de ses morceaux (« POL-CA-01#16+17 ») et les titres du premier ;
// dans le budget, il entre en entier ou pas du tout

// La position d'un chunk dans son document : « POL-CA-01#16 » donne 16. Un identifiant d'une autre forme (« GUIDE »,
// « POL-CA-01#16+17 ») donne NaN : ce passage-là reste tel quel
const position = (id: string) => Number(id.split("#")[1]);

export function fusionnerVoisins(passages: Resultat[]): Resultat[] {
  const parId = new Map(passages.map((p) => [p.id, p]));
  const traites = new Set<string>();
  const resultat: Resultat[] = [];
  for (const passage of passages) {
    if (traites.has(passage.id)) continue;
    if (!Number.isInteger(position(passage.id))) {
      resultat.push(passage);
      continue;
    }
    // La suite de passages consécutifs qui contient celui-ci : on recule, puis on avance, tant que le voisin est là
    const voisin = (n: number) => parId.get(`${passage.document}#${n}`);
    let debut = position(passage.id);
    while (voisin(debut - 1)) debut--;
    let fin = position(passage.id);
    while (voisin(fin + 1)) fin++;
    const suite = Array.from({ length: fin - debut + 1 }, (_, i) => voisin(debut + i)!);
    for (const p of suite) traites.add(p.id);
    // La suite prend la place du mieux classé de ses morceaux : le premier rencontré
    resultat.push(
      suite.length === 1
        ? passage
        : {
            ...suite[0],
            id: `${suite[0].id}${suite.slice(1).map((p) => `+${position(p.id)}`).join("")}`,
            texte: suite.map((p) => p.texte).join("\n\n"),
            score: Math.max(...suite.map((p) => p.score)),
          },
    );
  }
  return resultat;
}

// Les identifiants des chunks d'un passage, fusionné ou non : « POL-CA-01#16+17 » donne POL-CA-01#16 et POL-CA-01#17
export function idsDuPassage(id: string): string[] {
  const [document, positions] = id.split("#");
  if (positions === undefined) return [id];
  return positions.split("+").map((p) => `${document}#${p}`);
}
