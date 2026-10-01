// Petits chunks pour chercher, grand contexte pour répondre : on vectorise des morceaux courts, précis,
// mais on rend au LLM un passage plus large, qui contient de quoi répondre
import type { Document } from "../ingestion/document.ts";
import type { Chunk } from "./chunk.ts";
import type { Mesure } from "./mesure.ts";
import { blocs, collerIntroductions, redecouper, regrouper, sections } from "./structure.ts";

// Un morceau qu'on cherche, avec le passage qu'on rendra au LLM s'il est retrouvé
export type Recherchable = Chunk & { rendu: string };

// 1. Parent-enfant : le parent est une section entière. On ne le vectorise pas : il peut dépasser la limite du modèle.
// Ses enfants sont de petits morceaux de la section, vectorisés, qui rendent tous le texte du parent
export function parentsEtEnfants(document: Document, tailleEnfant: number, mesure: Mesure): Recherchable[] {
  const enfants: Recherchable[] = [];
  sections(document.texte).forEach((section, p) => {
    const titres = section.titres.length > 0 ? section.titres : [document.titre];
    const parent = [section.titre, section.corps.trim()].filter(Boolean).join("\n\n");
    const morceaux = collerIntroductions(blocs(section.corps)).flatMap((bloc) => redecouper(bloc, tailleEnfant, mesure));
    regrouper(morceaux, tailleEnfant, mesure).forEach((morceau, e) => {
      const texte = morceau.trim();
      enfants.push({ id: `${document.id}#${p + 1}.${e + 1}`, document: document.id, titres, texte, taille: mesure(texte), rendu: parent });
    });
  });
  return enfants;
}

// 2. Fenêtre de phrases : chaque phrase est vectorisée seule, et rend la phrase entourée de ses voisines.
// Intl.Segmenter, intégré à Node, découpe un texte en phrases ; chaque phrase garde les blancs qui la suivent
const segmenteur = new Intl.Segmenter("fr", { granularity: "sentence" });
export const phrases = (texte: string) => Array.from(segmenteur.segment(texte), (s) => s.segment).filter((s) => s.trim() !== "");

export function phrasesEtFenetres(document: Document, rayon: number, mesure: Mesure): Recherchable[] {
  const resultat: Recherchable[] = [];
  sections(document.texte).forEach((section, p) => {
    const titres = section.titres.length > 0 ? section.titres : [document.titre];
    const liste = phrases(section.corps); // une fenêtre ne déborde jamais sur la section voisine
    liste.forEach((phrase, i) => {
      const texte = phrase.trim();
      const fenetre = liste.slice(Math.max(0, i - rayon), i + rayon + 1).join("").trim();
      resultat.push({ id: `${document.id}#${p + 1}.${i + 1}`, document: document.id, titres, texte, taille: mesure(texte), rendu: fenetre });
    });
  });
  return resultat;
}
