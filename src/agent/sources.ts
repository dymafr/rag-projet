// Les sources que cite l'agent, entre crochets : [POL-TT-02#3]. Une source citée doit être celle d'un passage qu'un
// outil a rendu pendant la conversation ; sinon, le LLM l'a inventée
import type { Resultat } from "../recherche/vectorielle.ts";

export function sourcesCitees(texte: string, vus: Resultat[]): { citees: Resultat[]; inventees: string[] } {
  const parId = new Map(vus.map((p) => [p.id, p]));
  const ids = [...new Set([...texte.matchAll(/\[([^\[\]\s]+#\d+)\]/g)].map((m) => m[1]))];
  return { citees: ids.flatMap((id) => parId.get(id) ?? []), inventees: ids.filter((id) => !parId.has(id)) };
}
