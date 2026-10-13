// Les sources que cite l'agent, entre crochets : [POL-TT-02#3]. Une source citée doit être celle d'un passage qu'un
// outil a rendu pendant la conversation ; sinon, le LLM l'a inventée
import type { Resultat } from "../recherche/vectorielle.ts";

export function sourcesCitees(texte: string, vus: Resultat[]): { citees: Resultat[]; inventees: string[] } {
  const parId = new Map(vus.map((p) => [p.id, p]));
  const ids = [...new Set([...texte.matchAll(/\[([^\[\]\s]+#\d+)\]/g)].map((m) => m[1]))];
  return { citees: ids.flatMap((id) => parId.get(id) ?? []), inventees: ids.filter((id) => !parId.has(id)) };
}

// Leçon 7 : sur fichiers, l'agent cite un fichier, [FAQ-RH.md]. Il doit l'avoir lu ou y avoir trouvé une ligne
export function fichiersCites(texte: string, vus: Set<string>): { cites: string[]; inventes: string[] } {
  const ids = [...new Set([...texte.matchAll(/\[([^\[\]\s]+)\.md\]/g)].map((m) => m[1]))];
  return { cites: ids.filter((id) => vus.has(id)), inventes: ids.filter((id) => !vus.has(id)) };
}
