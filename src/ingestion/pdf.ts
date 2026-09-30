// Extraction du texte d'un PDF. Son texte est fait de morceaux posés à une position, avec une taille de police ;
// sa structure (titres, paragraphes, tableaux) n'y est pas toujours décrite. On la reconstruit à partir des positions
import { readFile } from "node:fs/promises";
import { getDocumentProxy } from "unpdf";

export type Morceau = { x: number; fin: number; texte: string }; // abscisses du début et de la fin, en points
export type Ligne = { y: number; taille: number; morceaux: Morceau[] };
export type Page = Ligne[];

// Deux morceaux d'une même ligne séparés par moins de 8 points forment un seul groupe de mots
const ECART_MAX = 8;

export async function lirePdf(chemin: string): Promise<Page[]> {
  const pdf = await getDocumentProxy(new Uint8Array(await readFile(chemin)));
  const pages: Page[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const { items } = await (await pdf.getPage(n)).getTextContent();
    const lignes: Ligne[] = [];
    // Du haut vers le bas de la page : l'ordonnée y part du bas, donc on trie par y décroissant
    const tries = items.flatMap((item) => ("str" in item && item.str.trim() ? [item] : []));
    tries.sort((a, b) => b.transform[5] - a.transform[5]);
    for (const item of tries) {
      const [x, y] = [item.transform[4], item.transform[5]];
      const morceau = { x, fin: x + item.width, texte: item.str };
      const taille = Math.round(item.height * 10) / 10;
      const derniere = lignes.at(-1);
      if (derniere && Math.abs(derniere.y - y) < 2) {
        derniere.morceaux.push(morceau); // même ligne, à 2 points près
        derniere.taille = Math.max(derniere.taille, taille);
      } else {
        lignes.push({ y, taille, morceaux: [morceau] });
      }
    }
    pages.push(lignes.map((ligne) => ({ ...ligne, morceaux: regrouper(ligne.morceaux) })));
  }
  return pages;
}

// Les morceaux d'une ligne, de gauche à droite ; ceux qui se touchent presque sont recollés
function regrouper(morceaux: Morceau[]): Morceau[] {
  const groupes: Morceau[] = [];
  for (const m of morceaux.toSorted((a, b) => a.x - b.x)) {
    const precedent = groupes.at(-1);
    const ecart = precedent ? m.x - precedent.fin : Infinity;
    if (precedent && ecart < ECART_MAX) {
      precedent.texte += (ecart > 1 ? " " : "") + m.texte;
      precedent.fin = m.fin;
    } else {
      groupes.push({ ...m });
    }
  }
  return groupes;
}

// Un PDF scanné ne contient que des images : presque aucun texte à extraire
export function estScanne(pages: Page[]): boolean {
  const caracteres = pages.flat().flatMap((l) => l.morceaux).reduce((total, m) => total + m.texte.length, 0);
  return caracteres < 100 * pages.length;
}

export const texteDe = (ligne: Ligne) => ligne.morceaux.map((m) => m.texte).join(" ");

// Recolle deux lignes. Un trait d'union en fin de ligne se recolle sans espace : « POL-TP- » puis « 01 »
export const recoller = (debut: string, suite: string) => (debut.endsWith("-") ? debut + suite : `${debut} ${suite}`);

// En-têtes et pieds de page : le texte répété sur chaque page

// Les nombres sont remplacés : « Page 2 / 5 » et « Page 3 / 5 » ont la même signature
const signature = (ligne: Ligne) => texteDe(ligne).replace(/\d+/g, "#");
// Seules les deux premières et les deux dernières lignes d'une page peuvent être un en-tête ou un pied de page
const bords = (page: Page) => [...page.slice(0, 2), ...page.slice(-2)];

// Retire les lignes de bord qui reviennent sur au moins la moitié des pages (et au moins deux)
export function retirerRepetitions(pages: Page[]): Page[] {
  const frequences = new Map<string, number>();
  for (const page of pages) {
    for (const s of new Set(bords(page).map(signature))) frequences.set(s, (frequences.get(s) ?? 0) + 1);
  }
  const seuil = Math.max(2, pages.length / 2);
  const repetees = new Set([...frequences].filter(([, n]) => n >= seuil).map(([s]) => s));
  return pages.map((page) => page.filter((ligne) => !(bords(page).includes(ligne) && repetees.has(signature(ligne)))));
}

// Tableaux : des lignes dont les groupes de mots commencent aux mêmes abscisses, celles des colonnes

// Une cellule commence à l'abscisse de sa colonne, à 3 points près
const colonneDe = (x: number, colonnes: number[]) => colonnes.findIndex((c) => Math.abs(c - x) < 3);

// Si un tableau commence à la ligne « debut » : son Markdown, et l'indice de la ligne qui le suit.
// L'en-tête donne les colonnes ; les lignes suivantes en font partie tant que leurs groupes de mots
// commencent tous sur une colonne, avec la même taille de police
export function lireTableau(lignes: Ligne[], debut: number): { markdown: string; fin: number } | undefined {
  const entete = lignes[debut];
  const colonnes = entete.morceaux.map((m) => m.x);
  if (colonnes.length < 2) return undefined;
  const aligne = (l: Ligne) => l.taille === entete.taille && l.morceaux.every((m) => colonneDe(m.x, colonnes) >= 0);

  const rangees: string[][] = [];
  let fin = debut;
  for (; fin < lignes.length && aligne(lignes[fin]); fin++) {
    const ligne = lignes[fin];
    // Un écart vertical plus grand qu'entre deux lignes d'un paragraphe : nouvelle rangée.
    // Sinon, la ligne continue les cellules de la rangée précédente (texte sur plusieurs lignes)
    if (fin === debut || lignes[fin - 1].y - ligne.y >= 1.6 * ligne.taille) rangees.push(colonnes.map(() => ""));
    const rangee = rangees.at(-1)!;
    for (const m of ligne.morceaux) {
      const c = colonneDe(m.x, colonnes);
      rangee[c] = rangee[c] ? recoller(rangee[c], m.texte) : m.texte;
    }
  }
  // Un vrai tableau a, sous son en-tête, une rangée d'au moins deux cellules remplies
  if (rangees.length < 2 || rangees[1].filter(Boolean).length < 2) return undefined;
  const enMarkdown = (cellules: string[]) => `| ${cellules.join(" | ")} |`;
  const [titres, ...corps] = rangees;
  const markdown = [enMarkdown(titres), enMarkdown(titres.map(() => "---")), ...corps.map(enMarkdown)].join("\n");
  return { markdown, fin };
}

// La taille du texte courant : celle qui porte le plus de caractères
function tailleDuCorps(lignes: Ligne[]): number {
  const caracteres = new Map<number, number>();
  for (const l of lignes) caracteres.set(l.taille, (caracteres.get(l.taille) ?? 0) + texteDe(l).length);
  return [...caracteres].sort((a, b) => b[1] - a[1])[0][0];
}

// Deux lignes font partie du même bloc si elles ont la même taille et se suivent de près :
// moins de 1,6 fois la taille de la police entre elles (entre deux paragraphes, l'écart est plus grand).
// D'une page à l'autre, l'écart ne veut plus rien dire : le bloc continue si sa phrase n'est pas finie
function suite(precedente: Ligne | undefined, ligne: Ligne, nouvellePage: boolean): boolean {
  if (!precedente || precedente.taille !== ligne.taille) return false;
  if (nouvellePage) return !/[.:;!?][\s)»]*$/.test(texteDe(precedente)); // ponctuation finale, éventuellement suivie d'espaces, de ) ou de »
  return precedente.y - ligne.y < 1.6 * ligne.taille;
}

// Les lignes deviennent du Markdown : titres repérés à leur taille, paragraphes recollés, listes à puces
export function versMarkdown(pages: Page[]): string {
  const lignes = pages.flat();
  const corps = tailleDuCorps(lignes);
  const marge = Math.min(...lignes.filter((l) => l.taille === corps).map((l) => l.morceaux[0].x)); // bord gauche du texte
  // Les tailles plus grandes que le corps, de la plus grande à la plus petite : #, ##, ###
  const titres = [...new Set(lignes.map((l) => l.taille))].filter((t) => t > corps).sort((a, b) => b - a);

  const blocs: string[] = [];
  let precedente: Ligne | undefined;
  for (const page of pages) {
    for (let i = 0; i < page.length; i++) {
      const tableau = lireTableau(page, i);
      if (tableau) {
        const [entete, , ...rangees] = tableau.markdown.split("\n");
        // Un tableau coupé par un saut de page : son en-tête est répété en haut de la page suivante
        if (i === 0 && blocs.at(-1)?.startsWith(`${entete}\n`)) blocs.push([blocs.pop(), ...rangees].join("\n"));
        else blocs.push(tableau.markdown);
        i = tableau.fin - 1; // on reprend à la ligne qui suit le tableau
        precedente = undefined;
        continue;
      }
      const ligne = page[i];
      const texte = texteDe(ligne);
      const niveau = titres.indexOf(ligne.taille) + 1;
      if (suite(precedente, ligne, i === 0)) {
        blocs.push(recoller(blocs.pop()!, texte));
      } else if (niveau > 0) {
        blocs.push(`${"#".repeat(Math.min(niveau, 4))} ${texte}`);
      } else if (ligne.morceaux[0].x > marge + 10 && !/^\d+\./.test(texte)) {
        blocs.push(`- ${texte}`); // en retrait, sans numéro : un élément de liste dont la puce a disparu
      } else {
        blocs.push(texte);
      }
      precedente = ligne;
    }
  }
  return blocs.join("\n\n").replaceAll("\n\n- ", "\n- "); // les éléments d'une liste se suivent sans ligne vide
}

export async function pdfVersMarkdown(chemin: string): Promise<string> {
  const pages = await lirePdf(chemin);
  if (estScanne(pages)) throw new Error(`${chemin} : PDF scanné, sans texte à extraire (il faut un OCR)`);
  return versMarkdown(retirerRepetitions(pages));
}
