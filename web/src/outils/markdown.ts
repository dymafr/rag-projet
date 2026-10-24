// Un Markdown réduit, pour les réponses de Rhéa : paragraphes, titres, listes (imbriquées), code, tableaux, citations en
// bloc, gras, italique, code en ligne, et les sources citées entre crochets [POL-TT-02#3]. Le texte devient un arbre que
// React affiche comme du texte : aucune balise n'est jamais interprétée, un passage piégé reste lisible et inoffensif

export type EnLigne =
  | { type: "texte"; texte: string }
  | { type: "gras"; enfants: EnLigne[] }
  | { type: "italique"; enfants: EnLigne[] }
  | { type: "code"; texte: string }
  | { type: "citation"; id: string }
  | { type: "lien"; texte: string; url: string }
  | { type: "saut" };

export type Bloc =
  | { type: "paragraphe"; enfants: EnLigne[] }
  | { type: "titre"; niveau: number; enfants: EnLigne[] }
  | { type: "liste"; ordonnee: boolean; debut: number; elements: Bloc[][] }
  | { type: "code"; texte: string }
  | { type: "tableau"; entete: EnLigne[][]; lignes: EnLigne[][][] }
  | { type: "bloc-cite"; blocs: Bloc[] }
  | { type: "separateur" };

const ITEM = /^(\s*)([-*+•]|\d{1,3}[.)])\s+(.*)$/;
const CLOTURE = /^\s*(```|~~~)/;
const TITRE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const SEPARATEUR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const LIGNE_DE_TABLEAU = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const CITE = /^\s{0,3}>\s?/;

const retrait = (ligne: string) => ligne.length - ligne.trimStart().length;
const commenceUnBloc = (ligne: string) => CLOTURE.test(ligne) || TITRE.test(ligne) || ITEM.test(ligne) || CITE.test(ligne) || SEPARATEUR.test(ligne);

export function lireMarkdown(texte: string): Bloc[] {
  return blocsDe(texte.replace(/\r\n?/g, "\n").split("\n"));
}

function blocsDe(lignes: string[]): Bloc[] {
  const blocs: Bloc[] = [];
  let i = 0;
  while (i < lignes.length) {
    const ligne = lignes[i];
    if (!ligne.trim()) {
      i++;
      continue;
    }
    if (CLOTURE.test(ligne)) {
      const contenu: string[] = [];
      i++;
      while (i < lignes.length && !CLOTURE.test(lignes[i])) contenu.push(lignes[i++]);
      i++;
      blocs.push({ type: "code", texte: contenu.join("\n") });
      continue;
    }
    const titre = TITRE.exec(ligne);
    if (titre) {
      blocs.push({ type: "titre", niveau: titre[1].length, enfants: lireEnLigne(titre[2]) });
      i++;
      continue;
    }
    if (SEPARATEUR.test(ligne)) {
      blocs.push({ type: "separateur" });
      i++;
      continue;
    }
    if (ligne.includes("|") && i + 1 < lignes.length && LIGNE_DE_TABLEAU.test(lignes[i + 1])) {
      const cellules = (l: string) =>
        l
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => lireEnLigne(c.trim()));
      const entete = cellules(ligne);
      const rangees: EnLigne[][][] = [];
      i += 2;
      while (i < lignes.length && lignes[i].includes("|") && lignes[i].trim()) rangees.push(cellules(lignes[i++]));
      blocs.push({ type: "tableau", entete, lignes: rangees });
      continue;
    }
    if (CITE.test(ligne)) {
      const contenu: string[] = [];
      while (i < lignes.length && lignes[i].trim() && (CITE.test(lignes[i]) || !commenceUnBloc(lignes[i]))) contenu.push(lignes[i++].replace(CITE, ""));
      blocs.push({ type: "bloc-cite", blocs: blocsDe(contenu) });
      continue;
    }
    if (ITEM.test(ligne)) {
      const [liste, suite] = lireListe(lignes, i);
      blocs.push(liste);
      i = suite;
      continue;
    }
    const paragraphe: string[] = [];
    while (i < lignes.length && lignes[i].trim() && !(paragraphe.length > 0 && commenceUnBloc(lignes[i]))) paragraphe.push(lignes[i++].trim());
    blocs.push({ type: "paragraphe", enfants: lignesEnLigne(paragraphe) });
  }
  return blocs;
}

function lireListe(lignes: string[], debut: number): [Bloc, number] {
  const premier = ITEM.exec(lignes[debut])!;
  const niveau = premier[1].length;
  const ordonnee = /\d/.test(premier[2]);
  const elements: Bloc[][] = [];
  let i = debut;
  while (i < lignes.length) {
    const m = ITEM.exec(lignes[i]);
    if (!m || m[1].length !== niveau || /\d/.test(m[2]) !== ordonnee) break;
    const contenu = [m[3]];
    i++;
    while (i < lignes.length) {
      const l = lignes[i];
      if (!l.trim()) {
        // Une ligne vide : l'élément continue si la suite est en retrait (un paragraphe de plus dans l'élément)
        let j = i + 1;
        while (j < lignes.length && !lignes[j].trim()) j++;
        if (j < lignes.length && retrait(lignes[j]) > niveau && !(ITEM.test(lignes[j]) && retrait(lignes[j]) <= niveau)) {
          contenu.push("");
          i++;
          continue;
        }
        break;
      }
      const sous = ITEM.exec(l);
      if (sous && sous[1].length <= niveau) break;
      if (!sous && retrait(l) <= niveau && commenceUnBloc(l)) break;
      contenu.push(l.slice(Math.min(retrait(l), niveau + 2)));
      i++;
    }
    elements.push(blocsDe(contenu));
  }
  return [{ type: "liste", ordonnee, debut: ordonnee ? Number.parseInt(premier[2], 10) || 1 : 1, elements }, i];
}

function lignesEnLigne(lignes: string[]): EnLigne[] {
  const enfants: EnLigne[] = [];
  lignes.forEach((l, i) => {
    if (i > 0) enfants.push({ type: "saut" });
    enfants.push(...lireEnLigne(l));
  });
  return enfants;
}

// Le texte d'une ligne : code en ligne, gras, sources citées, liens (montrés, jamais suivis), italique
const EN_LIGNE =
  /`([^`\n]+)`|\*\*(?=\S)(.+?)\*\*|__(?=\S)(.+?)__|\[([^[\]\s]+#\d+)\]|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)|\*(?=[^\s*])([^*\n]+?)\*|(?<![\p{L}\p{N}_])_(?=[^\s_])([^_\n]+?)_(?![\p{L}\p{N}_])/gu;

export function lireEnLigne(texte: string): EnLigne[] {
  const resultat: EnLigne[] = [];
  let dernier = 0;
  for (const m of texte.matchAll(EN_LIGNE)) {
    const debut = m.index ?? 0;
    if (debut > dernier) resultat.push({ type: "texte", texte: texte.slice(dernier, debut) });
    if (m[1] !== undefined) resultat.push({ type: "code", texte: m[1] });
    else if (m[2] !== undefined || m[3] !== undefined) resultat.push({ type: "gras", enfants: lireEnLigne(m[2] ?? m[3]) });
    else if (m[4] !== undefined) resultat.push({ type: "citation", id: m[4] });
    else if (m[5] !== undefined) resultat.push({ type: "lien", texte: m[5], url: m[6] });
    else resultat.push({ type: "italique", enfants: lireEnLigne(m[7] ?? m[8]) });
    dernier = debut + m[0].length;
  }
  if (dernier < texte.length) resultat.push({ type: "texte", texte: texte.slice(dernier) });
  return resultat;
}

// Le texte brut d'une réponse, sans marques : pour un aperçu sur une ligne
export function texteBrut(texte: string): string {
  return texte
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
