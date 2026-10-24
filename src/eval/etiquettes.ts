// Fiabiliser le juge (chapitre 14, leçon 4). Un juge LLM se trompe : le local, souvent (sur l'exécution de référence, il
// jugeait fausse une réponse juste sur les jours fériés de novembre) ; un juge hébergé, moins, mais pas jamais. On fait juger
// les mêmes réponses par deux juges de fournisseurs différents (un juge note mieux les réponses de son propre fournisseur),
// et un humain tranche chaque désaccord. Ses décisions, les étiquettes, servent ensuite à mesurer chaque juge : combien de
// réponses justes il reconnaît, combien de fausses il attrape. Ces taux ne portent que sur les désaccords, les seules
// réponses étiquetées : pour mesurer un juge, étiquetez aussi des réponses tirées au hasard parmi les accords
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import type { Execution, ResultatQuestion } from "./production.ts";
import { empreinte } from "./reponses.ts";

export const ETIQUETTES = "eval/production/etiquettes.json";

// Une étiquette : la décision humaine sur une réponse (réussie ou non), pour une empreinte de réponse donnée. Si la réponse
// change (une autre exécution, un autre modèle), l'étiquette ne s'applique plus : elle juge un texte, pas une question
export const Etiquette = z.strictObject({
  id: z.string(),
  reponse: z.string().length(12), // l'empreinte du texte jugé (reponses.ts)
  reussie: z.boolean(),
  raison: z.string().min(1),
  date: z.iso.date(),
});
export type Etiquette = z.infer<typeof Etiquette>;

export async function lireEtiquettes(fichier = ETIQUETTES): Promise<Etiquette[]> {
  try {
    return z.array(Etiquette).parse(JSON.parse(await readFile(fichier, "utf8")));
  } catch (erreur) {
    if ((erreur as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw erreur;
  }
}

// Ajouter ou remplacer l'étiquette d'une réponse (même question, même texte)
export async function etiqueter(etiquette: Etiquette, fichier = ETIQUETTES) {
  const liste = (await lireEtiquettes(fichier)).filter((e) => !(e.id === etiquette.id && e.reponse === etiquette.reponse));
  liste.push(Etiquette.parse(etiquette));
  liste.sort((a, b) => a.id.localeCompare(b.id, "fr", { numeric: true }));
  await writeFile(fichier, `${JSON.stringify(liste, null, 2)}\n`);
}

export type Desaccord = { id: string; question: string; reponse: string; empreinte: string; a: boolean | null; b: boolean | null; raisonsA: string[]; raisonsB: string[] };

// Les questions où deux exécutions (les mêmes réponses, deux juges) ne rendent pas le même verdict
export function desaccords(a: Execution, b: Execution): Desaccord[] {
  const parId = new Map(b.resultats.map((r) => [r.question.id, r]));
  const raisons = (r: ResultatQuestion) => r.verdict.criteres.filter((c) => c.ok !== true).map((c) => `${c.critere} : ${c.raison}`);
  return a.resultats.flatMap((ra) => {
    const rb = parId.get(ra.question.id);
    if (!rb || ra.obtenu.texte !== rb.obtenu.texte || ra.verdict.reussie === rb.verdict.reussie) return [];
    return [{ id: ra.question.id, question: ra.question.question, reponse: ra.obtenu.texte, empreinte: empreinte(ra.obtenu.texte), a: ra.verdict.reussie, b: rb.verdict.reussie, raisonsA: raisons(ra), raisonsB: raisons(rb) }];
  });
}

// Le score vérifié d'une exécution jugée deux fois (les mêmes réponses, deux juges) : une question est réussie quand
// l'étiquette humaine de sa réponse le dit, ou, sans étiquette, quand les deux juges l'acceptent. Un désaccord sans
// étiquette reste à trancher : il n'est pas compté comme réussi, et la sortie le compte à part
export function scoreVerifie(a: Execution, b: Execution, etiquettes: Etiquette[]) {
  const parCle = new Map(etiquettes.map((e) => [`${e.id} ${e.reponse}`, e.reussie]));
  const parId = new Map(b.resultats.map((r) => [r.question.id, r]));
  let reussies = 0;
  let aTrancher = 0;
  for (const ra of a.resultats) {
    const humain = parCle.get(`${ra.question.id} ${empreinte(ra.obtenu.texte)}`);
    const rb = parId.get(ra.question.id);
    if (humain !== undefined) reussies += humain ? 1 : 0;
    else if (rb && rb.obtenu.texte === ra.obtenu.texte && rb.verdict.reussie === ra.verdict.reussie) reussies += ra.verdict.reussie ? 1 : 0;
    else aTrancher++;
  }
  return { reussies, aTrancher, total: a.resultats.length };
}

// La fiabilité d'un juge contre les étiquettes humaines : la part des réponses justes qu'il dit justes (sensibilité), et
// des fausses qu'il dit fausses (spécificité). Deux taux, parce qu'un juge qui dit « réussie » à tout aurait une bonne
// exactitude sur un jeu presque tout réussi, et ne servirait à rien
export function fiabilite(execution: Execution, etiquettes: Etiquette[]) {
  const parCle = new Map(etiquettes.map((e) => [`${e.id} ${e.reponse}`, e.reussie]));
  let vraisPositifs = 0, positifs = 0, vraisNegatifs = 0, negatifs = 0;
  for (const r of execution.resultats) {
    const humain = parCle.get(`${r.question.id} ${empreinte(r.obtenu.texte)}`);
    if (humain === undefined || r.verdict.reussie === null) continue;
    if (humain) (positifs++, r.verdict.reussie && vraisPositifs++);
    else (negatifs++, !r.verdict.reussie && vraisNegatifs++);
  }
  return { etiquetees: positifs + negatifs, sensibilite: positifs ? vraisPositifs / positifs : null, specificite: negatifs ? vraisNegatifs / negatifs : null, positifs, negatifs };
}
