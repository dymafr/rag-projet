// Le verdict d'une question du jeu de production (chapitre 14, leçon 2). Ce qui se vérifie sans LLM se vérifie sans LLM :
// les motifs attendus (une valeur exacte : un solde, un nom) et interdits (ce qui ne doit jamais sortir). Le reste passe
// par le juge du chapitre 8 : l'exactitude face à la réponse de référence, le refus pour une question hors corpus ou
// interdite, et, pour information, la fidélité aux passages lus. Une question réussie :
// - couverte : exacte (si elle a une référence), avec chaque motif attendu, sans aucun motif interdit ;
// - hors corpus ou interdite : un refus, sans aucun motif interdit
import type { Llm } from "../llm.ts";
import { juger, type Critere as CritereDuJuge } from "./juge.ts";
import type { Critere, QuestionProduction, Verdict } from "./production.ts";

// Un motif se cherche sans tenir compte de la casse
const trouve = (motif: string, texte: string) => new RegExp(motif, "iu").test(texte);

export function motifs(question: QuestionProduction, texte: string): Critere[] {
  const criteres: Critere[] = [];
  if (question.attendu) {
    const manquants = question.attendu.filter((m) => !trouve(m, texte));
    criteres.push({ critere: "attendu", ok: manquants.length === 0, raison: manquants.length === 0 ? "tous les motifs attendus sont présents" : `absent : ${manquants.join(", ")}` });
  }
  if (question.interdit) {
    const presents = question.interdit.filter((m) => trouve(m, texte));
    criteres.push({ critere: "interdit", ok: presents.length === 0, raison: presents.length === 0 ? "aucun motif interdit" : `présent : ${presents.join(", ")}` });
  }
  return criteres;
}

// La décision, à partir des critères : un critère non jugé (null) qui décide rend la question non jugée
export function decider(question: QuestionProduction, criteres: Critere[]): boolean | null {
  const decisifs = criteres.filter((c) => c.critere !== "fidelite"); // la fidélité informe, elle ne décide pas (leçon 4)
  if (decisifs.some((c) => c.ok === false)) return false;
  if (decisifs.some((c) => c.ok === null)) return null;
  if (question.categorie !== "couverte" && !decisifs.some((c) => c.critere === "refus")) return null;
  return decisifs.length > 0;
}

export type AJugerProduction = { texte: string; passagesLus: { id: string; texte: string }[] };

export async function verdictDe(question: QuestionProduction, obtenu: AJugerProduction, juge: Llm | null): Promise<Verdict> {
  const criteres = motifs(question, obtenu.texte);
  const parLeJuge = async (critere: CritereDuJuge & Critere["critere"], avecPassages: boolean) => {
    if (!juge) return { critere, ok: null, raison: "sans juge (--sans-juge)" };
    const passages = avecPassages ? obtenu.passagesLus.map((p, i) => ({ numero: i + 1, texte: `[${p.id}] ${p.texte}` })) : [];
    const j = await juger(juge, critere, { question: question.question, reponse: obtenu.texte, passages, reference: question.reponse });
    return { critere, ok: j.verdict, raison: j.raison };
  };
  if (question.categorie === "couverte") {
    if (question.reponse) criteres.unshift(await parLeJuge("exactitude", false));
    if (question.reponse && obtenu.passagesLus.length > 0) criteres.push(await parLeJuge("fidelite", true));
  } else {
    criteres.unshift(await parLeJuge("refus", false));
  }
  return { reussie: decider(question, criteres), criteres };
}
