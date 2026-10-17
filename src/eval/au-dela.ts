// Le jeu du chapitre 12 : des questions « au-delà du texte ». Une question relationnelle se répond en suivant des liens
// entre personnes (qui est le manager de qui) ; une question statistique, en calculant sur un tableau (combien, quelle
// moyenne) ; une question globale porte sur tout le corpus (quels textes ont été remplacés). Les questions locales,
// celles que le RAG des chapitres précédents traite déjà, servent de témoins : elles ne doivent pas régresser.
// La vérification est mécanique, sans juge : la réponse doit contenir chaque mot attendu (un nom, un nombre) et aucun
// mot interdit. Un mot attendu peut avoir des variantes, séparées par | : « trois|3 ». Une question globale n'a pas de
// réponse courte à vérifier : elle n'est pas notée
import { readFile } from "node:fs/promises";
import { z } from "zod";

export const FAMILLES = ["locale", "relationnelle", "statistique", "globale"] as const;

export const QuestionAuDela = z.strictObject({
  id: z.string().regex(/^[LRSG]\d+$/),
  famille: z.enum(FAMILLES),
  question: z.string().trim().min(1),
  matricule: z.string().regex(/^K\d{4}$/).optional(), // le salarié connecté, si la question parle de « moi »
  attendu: z.array(z.string().min(1)).optional(),
  interdit: z.array(z.string().min(1)).optional(), // ce que la réponse ne doit pas dire (une donnée qu'il ne peut pas voir)
});
export type QuestionAuDela = z.infer<typeof QuestionAuDela>;

export async function lireJeuAuDela(fichier = "eval/jeu-c12.json"): Promise<QuestionAuDela[]> {
  const resultat = z.array(QuestionAuDela).safeParse(JSON.parse(await readFile(fichier, "utf8")));
  if (!resultat.success) throw new Error(`${fichier} invalide :\n${z.prettifyError(resultat.error)}`);
  return resultat.data;
}

// Sans accents ni majuscules, et la virgule décimale comme le point : « 4,3 » et « 4.3 » se valent. Un nombre attendu
// doit apparaître seul : « 9 » ne se trouve pas dans « 96 » ni dans « 19 »
const normaliser = (texte: string) =>
  texte.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/(\d),(\d)/g, "$1.$2").replace(/\s+/g, " ");

export function contient(reponse: string, mot: string): boolean {
  const r = normaliser(reponse);
  const m = normaliser(mot);
  if (/^\d+(\.\d+)?$/.test(m)) return new RegExp(`(?<![\\d.])${m.replace(".", "\\.")}(?![\\d]|\\.\\d)`).test(r);
  return r.includes(m);
}

export type Verdict = "réussie" | "manquée" | "non notée";

export function verdict(q: QuestionAuDela, reponse: string): Verdict {
  if (!q.attendu?.length && !q.interdit?.length) return "non notée";
  const attendus = (q.attendu ?? []).every((mot) => mot.split("|").some((variante) => contient(reponse, variante)));
  const interdits = (q.interdit ?? []).some((mot) => contient(reponse, mot));
  return attendus && !interdits ? "réussie" : "manquée";
}
