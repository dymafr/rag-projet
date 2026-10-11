// Les filtres que la question précise elle-même (auto-requête, ou self-query) : une période (« en janvier 2026 »,
// « l'an dernier ») ou un type de document (« dans la FAQ », « selon l'accord »). Le LLM les extrait dans un objet JSON
// validé par zod ; la recherche les applique ensuite comme les filtres du chapitre 6
import { z } from "zod";
import type { Llm } from "../llm.ts";
import { demanderJson } from "./llm-json.ts";
import type { Filtres } from "./vectorielle.ts";

// Les types que Rhéa peut lire (les tickets lui sont fermés : chapitre 13)
const TYPES = ["politique", "accord", "faq", "intranet"] as const;

// strictObject : une clé inattendue (un site, un auteur…) rend la réponse invalide plutôt que d'être ignorée en silence.
// Une liste de types vide veut dire « aucun type », comme null
const Extraits = z.strictObject({
  date: z.iso.date().nullable(),
  types: z
    .array(z.enum(TYPES))
    .nullable()
    .transform((types) => (types?.length ? types : null)),
});

const FORMAT = `Réponds uniquement avec un objet JSON : {"date": "AAAA-MM-JJ" ou null, "types": ["…"] ou null}`;
const consigne = (aujourdhui: string) => `Tu extrais d'une question de salarié les filtres de recherche qu'elle précise elle-même. Nous sommes le ${aujourdhui}.
- date : si la question porte sur une autre période qu'aujourd'hui (« en janvier 2026 », « l'an dernier », « avant mars »), une date située dans cette période, au format AAAA-MM-JJ ; sinon null.
- types : si la question demande un type de document précis, parmi ${TYPES.join(", ")} (« dans la FAQ » : faq ; « selon l'accord » : accord) ; sinon null.
N'invente rien : au moindre doute, null.
${FORMAT}`;

// Un appel au LLM n'est utile que si la question peut préciser quelque chose : une année, un mois, une période passée
// (« l'an dernier », « le mois passé »), une ancienne version ou un type de document. Des mots entiers seulement : « mai »
// n'est pas dans « semaine », ni « ancien » dans « ancienneté ». Les autres questions, la plupart, s'en passent
const MOIS = "janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre";
const PERIODE = "(?:an|ann[ée]e|mois|semaine)s? (?:derni[eè]re?s?|pass[ée]e?s?)";
const INDICES = new RegExp(`(?<![\\p{L}\\p{N}])(?:${MOIS}|(?:19|20)\\d\\d|${PERIODE}|ancienn?e?s?|faq|accords?|politiques?|intranet)(?![\\p{L}\\p{N}])`, "iu");
export const aDesIndices = (question: string) => INDICES.test(question);

// Les filtres à ajouter à ceux de Rhéa : enVigueurLe remplace la date du jour, types s'ajoute. {} si rien n'est précisé.
// Avant même la barrière d'abstention, la question part au LLM : sans conséquence avec un modèle local ; avec un
// fournisseur en ligne, elle quitte la machine, même si Rhéa s'abstient ensuite
export async function extraireFiltres(question: string, aujourdhui: string, llm: Llm): Promise<Pick<Filtres, "enVigueurLe" | "types">> {
  if (!aDesIndices(question)) return {};
  const lu = await demanderJson(llm, consigne(aujourdhui), `<question>\n${question}\n</question>`, Extraits, FORMAT);
  if (!lu) return {}; // réponse illisible : la recherche continue sans filtre ajouté
  return { ...(lu.date && { enVigueurLe: lu.date }), ...(lu.types && { types: lu.types }) };
}
