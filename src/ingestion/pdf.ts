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

// La taille du texte courant : celle qui porte le plus de caractères
function tailleDuCorps(lignes: Ligne[]): number {
  const caracteres = new Map<number, number>();
  for (const l of lignes) caracteres.set(l.taille, (caracteres.get(l.taille) ?? 0) + texteDe(l).length);
  return [...caracteres].sort((a, b) => b[1] - a[1])[0][0];
}

// Deux lignes font partie du même bloc si elles ont la même taille et se suivent de près :
// moins de 1,6 fois la taille de la police entre elles (entre deux paragraphes, l'écart est plus grand)
function suite(precedente: Ligne | undefined, ligne: Ligne): boolean {
  return !!precedente && precedente.taille === ligne.taille && precedente.y - ligne.y < 1.6 * ligne.taille;
}

// Les lignes deviennent du Markdown : titres repérés à leur taille, paragraphes recollés, listes à puces
export function versMarkdown(pages: Page[]): string {
  const lignes = pages.flat();
  const corps = tailleDuCorps(lignes);
  const marge = Math.min(...lignes.filter((l) => l.taille === corps).map((l) => l.morceaux[0].x)); // bord gauche du texte
  // Les tailles plus grandes que le corps, de la plus grande à la plus petite : #, ##, ###
  const titres = [...new Set(lignes.map((l) => l.taille))].filter((t) => t > corps).sort((a, b) => b - a);

  const blocs: string[] = [];
  for (const page of pages) {
    let precedente: Ligne | undefined; // on ne recolle jamais d'une page à l'autre
    for (const ligne of page) {
      const texte = texteDe(ligne);
      const niveau = titres.indexOf(ligne.taille) + 1;
      if (suite(precedente, ligne)) {
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
  return versMarkdown(pages);
}
