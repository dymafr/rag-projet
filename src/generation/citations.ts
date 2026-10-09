// Les citations d'une réponse : Rhéa cite chaque information avec le numéro de son passage entre crochets, [2]
import type { Resultat } from "../recherche/vectorielle.ts";
import type { Citation } from "./generateur.ts";

// Les numéros cités dans le texte, [2] ou [1, 3], chacun une fois, dans l'ordre croissant ; un numéro sans passage est ignoré
export function numerosCites(texte: string, passages: Resultat[]): number[] {
  const numeros = [...texte.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)].flatMap((m) => m[1].split(",").map(Number));
  return [...new Set(numeros)].filter((n) => n >= 1 && n <= passages.length).sort((a, b) => a - b);
}

// Les numéros cités, dans le texte ou par les citations, chacun une fois, et seulement s'ils désignent un passage fourni
export function numerosDesSources(texte: string, citations: Citation[], passages: Resultat[]): number[] {
  const numeros = new Set([...numerosCites(texte, passages), ...citations.map((c) => c.numero)]);
  return [...numeros].filter((n) => n >= 1 && n <= passages.length).sort((a, b) => a - b);
}

// Une source à afficher : le numéro, l'identifiant du chunk et le chemin de titres (document, puis article)
export const ligneDeSource = (numero: number, passage: Resultat) => `[${numero}] ${passage.id}  ${passage.titres.join(" > ")}`;

// 1. On compare des suites de mots : en minuscules, après NFKC, tout ce qui n'est ni lettre, ni chiffre, ni % ni €
// devient une espace. La casse, la ponctuation, les apostrophes, les guillemets, les tirets et la mise en forme Markdown
// ne comptent plus ; NFKC ramène aussi « ﬁ » à « fi » et un « é » décomposé à « é ». Un nombre garde ses limites :
// « 2,50 » devient « 2 50 », qui ne se confond pas avec « 250 »
export const normaliser = (texte: string) =>
  texte.normalize("NFKC").toLowerCase().replace(/[%€]/g, " $& ").replace(/[^\p{L}\p{N}%€]+/gu, " ").trim();

const ABREVIATION = /\[\s*(?:\.\.\.|…)\s*\]|\.\.\.|…/; // « … », « ... » ou « [...] »
const MORCEAU_MIN = 15; // en lettres et chiffres : une citation ou un morceau plus court (« [2] », « pas ») se trouve partout

// Les morceaux sont-ils dans ce texte, dans l'ordre, en mots entiers ? (une espace autour du texte et de chaque morceau)
function dansLOrdre(morceaux: string[], texte: string): boolean {
  const mots = ` ${normaliser(texte)} `;
  let depart = 0;
  for (const morceau of morceaux) {
    const position = mots.indexOf(` ${morceau} `, depart);
    if (position === -1) return false;
    depart = position + morceau.length + 1; // l'espace qui suit ce morceau peut ouvrir le suivant
  }
  return true;
}

// 2. La citation figure-t-elle dans le passage qu'elle cite ? On cherche des mots entiers : « 5 € » ne se trouve pas
// dans « 35 € ». Une citation abrégée est acceptée si chacun de ses morceaux figure dans le passage, dans l'ordre ; une
// citation trop courte, ou abrégée en miettes, ne prouve rien. Cela prouve que les mots cités sont dans le passage, pas
// que l'abréviation garde le sens, ni que le passage appuie la réponse
export function figureDans(citation: string, passage: string): boolean {
  const morceaux = citation.split(ABREVIATION).map(normaliser).filter(Boolean);
  if (morceaux.length === 0) return false; // une citation vide ne prouve rien
  if (morceaux.some((m) => m.replaceAll(" ", "").length < MORCEAU_MIN)) return false; // trop courte, ou en miettes
  if (dansLOrdre(morceaux, passage)) return true;
  // Claude cite des paragraphes entiers qui se suivent (leçon 4), et peut les recoller sans séparateur : « …télétravail »
  // puis « Mis à jour… » deviennent « télétravailMis ». On essaie donc aussi chaque suite de paragraphes recollés ainsi
  const paragraphes = passage.split(/\n\s*\n/).map((p) => p.trim());
  for (let debut = 0; debut < paragraphes.length; debut++) {
    for (let fin = debut + 2; fin <= paragraphes.length; fin++) {
      if (dansLOrdre(morceaux, paragraphes.slice(debut, fin).join(""))) return true;
    }
  }
  return false;
}

export type CitationVerifiee = Citation & { trouvee: boolean };

// 3. Chaque citation, vérifiée dans le passage dont elle donne le numéro
export const verifierCitations = (citations: Citation[], passages: Resultat[]): CitationVerifiee[] =>
  citations.map((c) => ({ ...c, trouvee: figureDans(c.texteCite, passages[c.numero - 1]?.texte ?? "") }));
