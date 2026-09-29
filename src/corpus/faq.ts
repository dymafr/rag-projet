// Lecture de la FAQ RH : une entrée par question, avec sa réponse
import { readFile } from "node:fs/promises";

export type EntreeFaq = { id: string; question: string; reponse: string };

export async function chargerFaq(chemin = "corpus/faq/faq-rh.md"): Promise<EntreeFaq[]> {
  const texte = await readFile(chemin, "utf8");
  // Chaque entrée commence par un titre « ## ». Ce qui précède le premier (en-tête YAML, introduction) est ignoré
  return texte
    .split("\n## ")
    .slice(1)
    .map((bloc, i) => {
      const [question, ...reponse] = bloc.split("\n");
      return { id: `FAQ-RH#${i + 1}`, question: question.trim(), reponse: reponse.join("\n").trim() };
    });
}
