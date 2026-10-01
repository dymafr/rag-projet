// Découpage structurel : on coupe d'abord aux titres, puis entre les paragraphes. Un bloc trop grand
// est redécoupé à son tour : aux lignes, puis aux fins de phrase, et en dernier recours entre deux mots
import type { Document } from "../ingestion/document.ts";
import type { Chunk } from "./chunk.ts";
import type { Mesure } from "./mesure.ts";

export type Section = { titres: string[]; titre: string; corps: string }; // titre : la ligne du titre, « ## Article 5. … »

// 1. Les sections : le texte coupé à chaque titre Markdown, chacune avec le chemin de ses titres.
// Dans un bloc de code, une ligne qui commence par « # » est un commentaire, pas un titre
export function sections(markdown: string): Section[] {
  const liste: Section[] = [{ titres: [], titre: "", corps: "" }];
  const chemin: string[] = []; // les titres en cours, du plus haut au plus bas : « # », puis « ## »… (un niveau sauté ne laisse pas de trou)
  let dansCode = false;
  for (const ligne of markdown.split("\n")) {
    if (ligne.startsWith("```")) dansCode = !dansCode;
    const titre = dansCode ? null : ligne.match(/^(#{1,6}) (.+)/);
    if (titre) {
      chemin.splice(titre[1].length - 1, Infinity, titre[2]); // il remplace le titre de son niveau et ceux en dessous
      liste.push({ titres: [...chemin], titre: ligne, corps: "" });
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
  const repete = niveau === 0 ? aRepeter(bloc) : undefined;
  if (repete) return decouperEnRepetant(repete, bloc.slice(repete.length + 1).split("\n"), taille, mesure);
  const morceaux = bloc.split(SEPARATEURS[niveau]).flatMap((morceau) => redecouper(morceau, taille, mesure, niveau + 1));
  return regrouper(morceaux, taille, mesure, "");
}

// 5. Une phrase qui annonce une liste ou un tableau (elle finit par « : ») reste collée au bloc qui la suit
export function collerIntroductions(liste: string[]): string[] {
  const resultat: string[] = [];
  for (const bloc of liste) {
    if (resultat.length > 0 && resultat[resultat.length - 1].endsWith(":")) resultat[resultat.length - 1] += `\n${bloc}`;
    else resultat.push(bloc);
  }
  return resultat;
}

// 6. Ce qu'il faut répéter quand on coupe un bloc : la phrase d'introduction s'il y en a une (elle finit par « : »),
// puis la ligne des titres de colonnes d'un tableau et sa ligne de tirets
export function aRepeter(bloc: string): string | undefined {
  const lignes = bloc.split("\n");
  const debut = lignes[0].endsWith(":") ? 1 : 0; // la ligne où commence le tableau ou la liste
  if (lignes[debut]?.startsWith("|") && lignes[debut + 1]?.startsWith("| ---")) return lignes.slice(0, debut + 2).join("\n");
  if (debut === 1 && /^(- |\d+\. )/.test(lignes[1] ?? "")) return lignes[0]; // une liste à tirets ou numérotée
  return undefined;
}

// Couper entre deux rangées (ou deux éléments de liste), en répétant ce qui doit l'être en haut de chaque morceau :
// une rangée n'est jamais séparée de la ligne des titres de ses colonnes
function decouperEnRepetant(repete: string, lignes: string[], taille: number, mesure: Mesure): string[] {
  const morceaux: string[] = [];
  for (const ligne of lignes) {
    const avec = morceaux.length > 0 ? `${morceaux[morceaux.length - 1]}\n${ligne}` : "";
    if (avec && mesure(avec) <= taille) morceaux[morceaux.length - 1] = avec;
    else morceaux.push(`${repete}\n${ligne}`);
  }
  return morceaux;
}

// Découper un document : chaque section en chunks d'au plus `taille`, sans jamais mélanger deux sections
export function decouperDocument(document: Document, taille: number, mesure: Mesure): Chunk[] {
  const chunks: Chunk[] = [];
  for (const section of sections(document.texte)) {
    // Le titre de la section ouvre chacun de ses chunks : une réponse de la FAQ garde sa question, un alinéa son article
    const titre = section.titre ? `${section.titre}\n\n` : "";
    const place = taille - mesure(titre); // ce qui reste pour le texte
    const morceaux = collerIntroductions(blocs(section.corps)).flatMap((bloc) => redecouper(bloc, place, mesure));
    for (const morceau of regrouper(morceaux, place, mesure)) {
      const texte = titre + morceau.trim();
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
