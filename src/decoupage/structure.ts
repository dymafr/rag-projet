// Découpage structurel : on coupe d'abord aux titres, puis entre les paragraphes. Un bloc trop grand
// est redécoupé à son tour : aux lignes, puis aux fins de phrase, et en dernier recours entre deux mots
import type { Document } from "../ingestion/document.ts";
import type { Chunk } from "./chunk.ts";
import type { Mesure } from "./mesure.ts";

export type Section = { titres: string[]; corps: string };

// 1. Les sections : le texte coupé à chaque titre Markdown, chacune avec le chemin de ses titres.
// Dans un bloc de code, une ligne qui commence par « # » est un commentaire, pas un titre
export function sections(markdown: string): Section[] {
  const liste: Section[] = [{ titres: [], corps: "" }];
  const chemin: string[] = []; // les titres en cours, du plus haut au plus bas : « # », puis « ## »… (un niveau sauté ne laisse pas de trou)
  let dansCode = false;
  for (const ligne of markdown.split("\n")) {
    if (ligne.startsWith("```")) dansCode = !dansCode;
    const titre = dansCode ? null : ligne.match(/^(#{1,6}) (.+)/);
    if (titre) {
      chemin.splice(titre[1].length - 1, Infinity, titre[2]); // il remplace le titre de son niveau et ceux en dessous
      liste.push({ titres: [...chemin], corps: "" });
    } else {
      liste[liste.length - 1].corps += `${ligne}\n`;
    }
  }
  return liste.filter((section) => section.corps.trim() !== ""); // un titre suivi d'un sous-titre n'a pas de texte à lui
}

// 2. Les blocs d'une section : paragraphes, listes, tableaux, séparés par une ligne vide.
// Un bloc de code (entre deux lignes ```) reste entier, même s'il contient des lignes vides
export function blocs(corps: string): string[] {
  const liste: string[] = [];
  let lignes: string[] = [];
  let dansCode = false;
  for (const ligne of corps.split("\n")) {
    if (ligne.startsWith("```")) dansCode = !dansCode;
    if (ligne.trim() === "" && !dansCode) {
      if (lignes.length > 0) liste.push(lignes.join("\n"));
      lignes = [];
    } else {
      lignes.push(ligne);
    }
  }
  if (lignes.length > 0) liste.push(lignes.join("\n"));
  return liste;
}

// 3. Regrouper des morceaux qui se suivent, tant que leur réunion ne dépasse pas la taille
export function regrouper(morceaux: string[], taille: number, mesure: Mesure, joint = "\n\n"): string[] {
  const groupes: string[] = [];
  for (const morceau of morceaux) {
    const avec = groupes.length > 0 ? groupes[groupes.length - 1] + joint + morceau : "";
    if (avec && mesure(avec) <= taille) groupes[groupes.length - 1] = avec;
    else groupes.push(morceau);
  }
  return groupes;
}

// 4. Redécouper un bloc trop grand, avec des séparateurs de plus en plus fins.
// Chaque morceau garde son séparateur : mis bout à bout, les morceaux redonnent le bloc
const SEPARATEURS = [/(?<=\n)/, /(?<=[.!?] )/, /(?<= )/]; // la ligne, la fin de phrase, l'espace entre deux mots

export function redecouper(bloc: string, taille: number, mesure: Mesure, niveau = 0): string[] {
  if (mesure(bloc) <= taille || niveau === SEPARATEURS.length) return [bloc];
  const morceaux = bloc.split(SEPARATEURS[niveau]).flatMap((morceau) => redecouper(morceau, taille, mesure, niveau + 1));
  return regrouper(morceaux, taille, mesure, "");
}

// Découper un document : chaque section en chunks d'au plus `taille`, sans jamais mélanger deux sections
export function decouperDocument(document: Document, taille: number, mesure: Mesure): Chunk[] {
  const chunks: Chunk[] = [];
  for (const section of sections(document.texte)) {
    const morceaux = blocs(section.corps).flatMap((bloc) => redecouper(bloc, taille, mesure));
    for (const morceau of regrouper(morceaux, taille, mesure)) {
      const texte = morceau.trim();
      chunks.push({
        id: `${document.id}#${chunks.length + 1}`,
        document: document.id,
        titres: section.titres.length > 0 ? section.titres : [document.titre], // un ticket n'a pas de titre Markdown
        texte,
        taille: mesure(texte),
      });
    }
  }
  return chunks;
}
