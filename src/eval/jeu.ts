// Le jeu d'évaluation : des questions de référence, chacune avec ce que Rhéa doit faire. Une question couverte
// a une réponse de référence et ses passages attendus ; une question hors corpus ou interdite attend une abstention
import { readFile } from "node:fs/promises";
import { z } from "zod";

// La pertinence d'un passage pour la question : 2, il y répond ; 1, il aide sans répondre seul
const Pertinence = z.union([z.literal(1), z.literal(2)]);

const Commun = {
  id: z.string().regex(/^Q\d{2,}$/, "attendu : Q suivi d'un numéro, par exemple Q07"),
  question: z.string().trim().min(1),
  date: z.iso.date().optional(), // la date du jour pour Rhéa, si la réponse en dépend ; sinon, le jour de l'évaluation
  origine: z.enum(["ecrite", "synthetique"]), // écrite à la main, ou générée par un LLM puis relue
};

export const QuestionDeReference = z.discriminatedUnion("categorie", [
  z.strictObject({
    ...Commun,
    categorie: z.literal("couverte"),
    reponse: z.string().min(1), // la réponse de référence, courte, tirée des documents
    passages: z.record(z.string(), Pertinence).refine((p) => Object.values(p).includes(2), "au moins un passage doit répondre (pertinence 2)"),
  }),
  z.strictObject({ ...Commun, categorie: z.enum(["hors-corpus", "interdite"]) }),
]);
export type QuestionDeReference = z.infer<typeof QuestionDeReference>;

export const Jeu = z.array(QuestionDeReference).superRefine((questions, ctx) => {
  const vues = new Set<string>();
  for (const [i, q] of questions.entries()) {
    if (vues.has(q.id)) ctx.addIssue({ code: "custom", path: [i, "id"], message: `identifiant en double : ${q.id}` });
    vues.add(q.id);
  }
});

export async function lireJeu(fichier = "eval/jeu.json") {
  const resultat = Jeu.safeParse(JSON.parse(await readFile(fichier, "utf8")));
  if (!resultat.success) throw new Error(`${fichier} invalide :\n${z.prettifyError(resultat.error)}`);
  return resultat.data;
}
