// Calibrer le juge : comparer ses verdicts à ceux d'un humain sur les mêmes réponses. Tant que le juge ne s'accorde
// pas assez avec l'humain, ses scores ne disent rien de fiable sur Rhéa
import { readFile } from "node:fs/promises";
import { z } from "zod";

export type Paire = { humain: boolean; juge: boolean };

export function comparer(paires: Paire[]) {
  const n = paires.length;
  // La matrice de confusion : les quatre cas possibles, « oui » voulant dire que la réponse passe le critère
  const vraiOui = paires.filter((p) => p.humain && p.juge).length;
  const vraiNon = paires.filter((p) => !p.humain && !p.juge).length;
  const fauxOui = paires.filter((p) => !p.humain && p.juge).length; // le juge laisse passer un défaut vu par l'humain
  const fauxNon = paires.filter((p) => p.humain && !p.juge).length; // le juge condamne une bonne réponse
  // L'accord : la part des réponses où le juge dit comme l'humain
  const accord = (vraiOui + vraiNon) / n;
  // Le kappa de Cohen retire de l'accord celui que donnerait le hasard. Si l'humain dit « oui » à 90 % des réponses,
  // un juge qui dit toujours « oui » s'accorde à 90 %, sans rien juger : son kappa vaut 0.
  // 1 : accord parfait ; 0 : pas mieux que le hasard ; négatif : moins bien. Impossible à calculer si l'humain et
  // le juge donnent tous deux toujours le même verdict, par exemple toujours « oui » : le hasard expliquerait tout
  const ouiHumain = (vraiOui + fauxNon) / n;
  const ouiJuge = (vraiOui + fauxOui) / n;
  const hasard = ouiHumain * ouiJuge + (1 - ouiHumain) * (1 - ouiJuge);
  const kappa = hasard === 1 ? null : (accord - hasard) / (1 - hasard);
  return { n, vraiOui, vraiNon, fauxOui, fauxNon, accord, kappa };
}

// Les verdicts d'un humain (eval/etiquettes.json), pour les mêmes critères que le juge. empreinte : celle du texte
// étiqueté ; si Rhéa a depuis répondu autrement, l'étiquette ne vaut plus pour la nouvelle réponse
export const Etiquette = z.object({
  id: z.string(),
  empreinte: z.string(),
  fidelite: z.boolean(),
  pertinence: z.boolean(),
  exactitude: z.boolean().optional(), // seulement pour une question couverte, qui a une réponse de référence
  note: z.string().optional(), // pourquoi, quand le verdict n'est pas évident
});
export type Etiquette = z.infer<typeof Etiquette>;

export async function lireEtiquettes(fichier = "eval/etiquettes.json"): Promise<Etiquette[]> {
  const resultat = z.array(Etiquette).safeParse(JSON.parse(await readFile(fichier, "utf8")));
  if (!resultat.success) throw new Error(`${fichier} invalide :\n${z.prettifyError(resultat.error)}`);
  return resultat.data;
}
