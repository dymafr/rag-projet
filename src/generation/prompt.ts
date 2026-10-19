// Le prompt augmenté : le prompt système, puis les passages trouvés par la recherche, délimités et numérotés,
// dans la limite d'un budget de tokens, et enfin la question
import type { Mesure } from "../decoupage/mesure.ts";
import { retirerInvisibles } from "../ingestion/injection.ts";
import type { Resultat } from "../recherche/vectorielle.ts";

// Les réglages par défaut : les passages demandés à la recherche, et les tokens qui leur sont réservés dans le prompt
export const PASSAGES_DEMANDES = 8;
export const BUDGET_PASSAGES = 1500;

export type PromptAugmente = {
  systeme: string; // les instructions : le prompt système de prompts/rhea.md
  utilisateur: string; // le message : les passages, la date du jour, puis la question
  passages: Resultat[]; // les passages gardés : le passage [n] est passages[n - 1]
  ecartes: Resultat[]; // ceux qui ne tenaient plus dans le budget
  question: string; // la question et la date, gardées à part : la leçon 4 construit le message autrement
  date: string;
};

// Sans le tokenizer du LLM, une estimation : 3 caractères par token. Sur nos prompts en français, le modèle local
// en compte un peu plus par token : l'estimation est prudente, et mieux vaut surestimer que dépasser
export const estimerTokens: Mesure = (texte) => Math.ceil(texte.length / 3);

// Des passages numérotés se citent par leur numéro : on le dit avec les passages eux-mêmes
export const CITER =
  "Voici les passages de la documentation RH trouvés pour cette question. Cite chaque information avec le numéro " +
  "de son passage entre crochets, juste après la phrase concernée : [2]. Pour plusieurs passages : [1][3].";

// 1. Un passage entre balises, avec son numéro (celui que Rhéa citera), son identifiant et son chemin de titres.
// Une balise passage ou passages écrite dans le texte ou le titre, ouvrante ou fermante, quelles que soient la casse et les
// espaces, est neutralisée : un passage ne peut ni fermer la liste ni en ouvrir un autre. Cela rend une injection plus difficile, sans l'empêcher.
// Sans numéro (l'agent du chapitre 10, qui cherche plusieurs fois), le passage se cite par sa source.
// Chapitre 13 : le passage d'un ticket dit son origine, un salarié et non le service RH. C'est un indice pour le LLM, qui
// distingue mieux une donnée d'une consigne quand il sait d'où elle vient ; un indice seulement, qu'un texte piégé peut
// imiter. Et les caractères invisibles sont retirés, même d'un index construit avant ce chapitre
export function baliser(passage: Resultat, numero?: number): string {
  const titre = retirerInvisibles(passage.titres.join(" > ")).replaceAll('"', "'").replace(/<(\s*\/?\s*passages?)/gi, "&lt;$1");
  const texte = retirerInvisibles(passage.texte).replace(/<(\s*\/?\s*passages?)/gi, "&lt;$1");
  const attribut = numero === undefined ? "" : `numero="${numero}" `;
  const origine = estUnTicket(passage) ? 'origine="ticket écrit par un salarié" ' : "";
  return `<passage ${attribut}source="${passage.id}" ${origine}titre="${titre}">\n${texte}\n</passage>`;
}

// Les tickets portent un identifiant de la forme TK-2026-0060 (chapitre 4)
export const estUnTicket = (passage: Resultat) => /^TK-\d{4}-\d{4}$/.test(passage.document);

// 2. Les passages, du plus proche au moins proche, tant qu'ils tiennent dans le budget. Un passage trop long
// pour la place qui reste est écarté, et on essaie le suivant ; un passage vide n'apporte rien
export function choisir(resultats: Resultat[], budget: number, mesure: Mesure) {
  const passages: Resultat[] = [];
  const ecartes: Resultat[] = [];
  let total = 0;
  for (const resultat of resultats) {
    if (!resultat.texte.trim()) continue;
    const taille = mesure(baliser(resultat, passages.length + 1));
    if (total + taille > budget) {
      ecartes.push(resultat);
      continue;
    }
    passages.push(resultat);
    total += taille;
  }
  return { passages, ecartes, total };
}

// 3. La fin du message : la date du jour (certaines règles changent), puis la question, en dernier
export const finDuMessage = (question: string, date: string) => `Date du jour : ${date}\n\nQuestion : ${question}`;

// 4. Le prompt complet. budget : les tokens réservés aux passages
export function assembler(
  question: string,
  resultats: Resultat[],
  options: { systeme: string; budget: number; mesure: Mesure; date: string },
): PromptAugmente {
  const { passages, ecartes } = choisir(resultats, options.budget, options.mesure);
  const blocs = passages.map((passage, i) => baliser(passage, i + 1)).join("\n\n");
  const utilisateur = `${CITER}\n\n<passages>\n${blocs}\n</passages>\n\n${finDuMessage(question, options.date)}`;
  return { systeme: options.systeme, utilisateur, passages, ecartes, question, date: options.date };
}
