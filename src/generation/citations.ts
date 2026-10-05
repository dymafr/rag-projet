// Les citations d'une réponse : Rhéa cite chaque information avec le numéro de son passage entre crochets, [2]
import type { Resultat } from "../recherche/vectorielle.ts";

// Les numéros cités dans le texte, chacun une fois, dans l'ordre croissant ; un numéro sans passage est ignoré
export function numerosCites(texte: string, passages: Resultat[]): number[] {
  const numeros = [...texte.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  return [...new Set(numeros)].filter((n) => n >= 1 && n <= passages.length).sort((a, b) => a - b);
}

// Une source à afficher : le numéro, l'identifiant du chunk et le chemin de titres (document, puis article)
export const ligneDeSource = (numero: number, passage: Resultat) => `[${numero}] ${passage.id}  ${passage.titres.join(" > ")}`;
