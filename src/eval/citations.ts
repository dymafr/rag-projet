// Évaluer les citations d'une réponse : les passages cités suffisent-ils à établir chaque phrase, et chaque citation
// sert-elle à quelque chose ? (le rappel et la précision des citations, définis par le banc d'essai ALCE).
// À ne pas confondre avec generation/citations.ts, qui vérifie qu'un extrait cité figure bien dans son passage :
// un extrait peut exister mot pour mot sans prouver la phrase qui le cite
export type Phrase = { texte: string; numeros: number[] };

// Les numéros cités : [2], ou [1, 3], comme les accepte Rhéa (numerosCites, au chapitre 7)
const CITATION = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

// 1. Découper la réponse en phrases, chacune avec les numéros de passage qu'elle cite : « Trois jours [1][2]. »
// Claude place ses numéros après le point (« Trois jours.[1] ») : on les ramène d'abord avant, pour qu'ils restent
// avec leur phrase. Le texte gardé pour le juge est sans les crochets. Limite de ce découpage simple : tout point
// suivi d'un blanc termine une phrase, même celui d'une abréviation (« art. 4 » donne deux phrases)
export function decouperEnPhrases(reponse: string): Phrase[] {
  return reponse
    .replace(/([.!?…])((?:\s*\[\d+(?:\s*,\s*\d+)*\])+)/g, "$2$1 ") // « jours.[1] » devient « jours[1]. »
    .split(/(?<=[.!?…])\s+/)
    .map((brute) => ({
      texte: brute.replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, "").trim(),
      numeros: [...new Set([...brute.matchAll(CITATION)].flatMap((m) => m[1].split(",").map(Number)))],
    }))
    .filter((p) => p.texte.length > 0);
}

// Le juge de soutien : ces passages, et eux seuls, établissent-ils toute la phrase ?
export type Soutien = (phrase: string, numeros: number[]) => Promise<boolean>;

export type CitationsDUneReponse = {
  phrases: (Phrase & { appuyee: boolean | null; utiles: boolean[] })[];
  rappel: number | null; // la part des phrases établies par leurs passages cités ; une phrase qui ne cite rien compte 0
  precision: number | null; // la part des citations utiles
  sansCitation: number; // les phrases qui ne citent rien : elles font baisser le rappel, même une formule de politesse
};

// 2. Pour chaque phrase qui cite : est-elle appuyée par l'ensemble de ses passages cités ? Puis, pour chaque citation :
// elle est inutile si son passage seul n'établit pas la phrase et que les autres l'établissent sans lui.
// Une citation d'une phrase non appuyée ne vaut rien. Les mêmes questions reviennent : on garde chaque verdict
export async function evaluerCitations(reponse: string, soutien: Soutien): Promise<CitationsDUneReponse> {
  const verdicts = new Map<string, Promise<boolean>>();
  const soutient = (phrase: string, numeros: number[]) => {
    if (numeros.length === 0) return Promise.resolve(false); // aucun passage n'établit rien
    const cle = `${[...numeros].sort((a, b) => a - b).join(",")}|${phrase}`;
    if (!verdicts.has(cle)) verdicts.set(cle, soutien(phrase, numeros));
    return verdicts.get(cle)!;
  };
  const phrases = [];
  for (const phrase of decouperEnPhrases(reponse)) {
    if (phrase.numeros.length === 0) {
      phrases.push({ ...phrase, appuyee: null, utiles: [] });
      continue;
    }
    const appuyee = await soutient(phrase.texte, phrase.numeros);
    const utiles = [];
    for (const n of phrase.numeros) {
      if (!appuyee) utiles.push(false);
      else if (phrase.numeros.length === 1) utiles.push(true);
      else {
        const autres = phrase.numeros.filter((m) => m !== n);
        const inutile = !(await soutient(phrase.texte, [n])) && (await soutient(phrase.texte, autres));
        utiles.push(!inutile);
      }
    }
    phrases.push({ ...phrase, appuyee, utiles });
  }
  const citantes = phrases.filter((p) => p.appuyee !== null);
  const citations = citantes.flatMap((p) => p.utiles);
  return {
    phrases,
    // Comme dans ALCE : toutes les phrases comptent, et une phrase qui ne cite rien n'est pas établie
    rappel: phrases.length === 0 ? null : phrases.filter((p) => p.appuyee === true).length / phrases.length,
    precision: citations.length === 0 ? null : citations.filter(Boolean).length / citations.length,
    sansCitation: phrases.length - citantes.length,
  };
}
