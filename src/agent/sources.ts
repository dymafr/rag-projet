// Les sources que cite l'agent, entre crochets : [POL-TT-02#3]. Une source citée doit être celle d'un passage qu'un
// outil a rendu pendant la conversation ; sinon, le LLM l'a inventée
import type { Resultat } from "../recherche/vectorielle.ts";

export function sourcesCitees(texte: string, vus: Resultat[]): { citees: Resultat[]; inventees: string[] } {
  const parId = new Map(vus.map((p) => [p.id, p]));
  const ids = [...new Set([...texte.matchAll(/\[([^\[\]\s]+#\d+)\]/g)].map((m) => m[1]))];
  return { citees: ids.flatMap((id) => parId.get(id) ?? []), inventees: ids.filter((id) => !parId.has(id)) };
}

// Chapitre 14, leçon 4 : un LLM recopie parfois une source avec un numéro de plus, [POL-TT-02#4-3] ou [POL-TT-02#4.3],
// pour désigner une phrase du passage POL-TT-02#4. Telle quelle, elle ne serait ni citée ni signalée comme inventée, et le
// vérificateur ne recevrait pas le passage : elle redevient [POL-TT-02#4], si ce passage a été lu
export const normaliserCitations = (texte: string, lus: { has: (id: string) => boolean }) =>
  texte.replace(/\[([^\[\]\s]+#\d+)(?:[-.]\d+)+\]/g, (cite, id: string) => (lus.has(id) ? `[${id}]` : cite));

// Leçon 7 : sur fichiers, l'agent cite un fichier, [FAQ-RH.md]. Il doit l'avoir lu ou y avoir trouvé une ligne
export function fichiersCites(texte: string, vus: Set<string>): { cites: string[]; inventes: string[] } {
  const ids = [...new Set([...texte.matchAll(/\[([^\[\]\s]+)\.md\]/g)].map((m) => m[1]))];
  return { cites: ids.filter((id) => vus.has(id)), inventes: ids.filter((id) => !vus.has(id)) };
}
