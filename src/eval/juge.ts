// Le juge : un LLM qui lit une réponse de Rhéa et rend, pour un critère, un verdict oui ou non avec sa raison.
// Un verdict binaire, défini par une consigne précise, se vérifie mieux qu'une note de 1 à 5 : on peut le comparer
// à celui d'un humain, réponse par réponse
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Llm, Usage } from "../llm.ts";

export const CRITERES_JUGES = ["fidelite", "pertinence", "exactitude"] as const;
export type Critere = (typeof CRITERES_JUGES)[number];

// Ce que le juge lit : la question, la réponse, les passages envoyés au LLM et, pour l'exactitude, la réponse de référence
export type AJuger = { question: string; reponse: string; passages: { numero: number; texte: string }[]; reference?: string };

// La raison d'abord, le verdict ensuite : le modèle tranche après avoir écrit ce qu'il a vérifié. z.object (et non
// strictObject) laisse passer une clé en trop : un modèle en ajoute parfois une, sans que son verdict soit faux
export const Verdict = z.object({ raison: z.string().min(1), verdict: z.enum(["oui", "non"]) });

const FORMAT = `Réponds uniquement avec un objet JSON : {"raison": "ce que tu as vérifié, en une ou deux phrases", "verdict": "oui" ou "non"}`;

const passages = (a: AJuger) => a.passages.map((p) => `<passage numero="${p.numero}">\n${p.texte}\n</passage>`).join("\n");

// Pour chaque critère : la consigne, identique d'un appel à l'autre (le début du prompt), et les données (la fin)
export const CRITERES: Record<Critere, { consigne: string; donnees: (a: AJuger) => string }> = {
  fidelite: {
    consigne: `Tu vérifies qu'une réponse d'un assistant RH est fidèle aux passages qu'il a reçus.
Réponds "oui" si chaque information de la réponse (chiffre, durée, condition, démarche, date) figure dans les passages ou s'en déduit directement.
Réponds "non" si une seule information n'y figure pas, même si elle te paraît vraie par ailleurs.
Une phrase sans contenu factuel n'a rien à vérifier : formule de politesse, phrase qui dit ne pas savoir, renvoi vers
le service RH, l'espace RH ou un ticket. Elle ne rend pas la réponse infidèle. Ignore aussi les numéros entre crochets.
${FORMAT}`,
    donnees: (a) => `<passages>\n${passages(a)}\n</passages>\n\n<reponse>\n${a.reponse}\n</reponse>`,
  },
  pertinence: {
    consigne: `Tu vérifies qu'une réponse d'un assistant RH répond à la question posée par le salarié.
Réponds "oui" si elle traite la question posée, toute la question, sans s'en écarter.
Réponds "non" si elle répond à une autre question, à une partie seulement de la question, ou si elle l'évite.
Ne juge pas si la réponse est exacte : seulement si elle répond à ce qui est demandé.
${FORMAT}`,
    donnees: (a) => `<question>\n${a.question}\n</question>\n\n<reponse>\n${a.reponse}\n</reponse>`,
  },
  exactitude: {
    consigne: `Tu compares la réponse d'un assistant RH à la réponse de référence, écrite par un expert.
Les informations essentielles sont celles qui répondent directement à la question : le chiffre, la règle, la condition principale.
Réponds "oui" si la réponse donne ces informations essentielles sans contredire la référence. Elle peut être formulée autrement,
plus courte ou plus longue ; l'absence d'un détail secondaire de la référence (une exception, une majoration, une précision) n'est pas une erreur.
Réponds "non" si elle contredit la référence, s'il lui manque une information essentielle, ou si elle ajoute une information fausse.
${FORMAT}`,
    donnees: (a) => `<question>\n${a.question}\n</question>\n\n<reference>\n${a.reference ?? ""}\n</reference>\n\n<reponse>\n${a.reponse}\n</reponse>`,
  },
};

// Un modèle entoure parfois le JSON de texte ou de balises : on garde ce qui va de la première { à la dernière }
export function lireJson(texte: string): unknown {
  try {
    return JSON.parse(texte.match(/\{[\s\S]*\}/)?.[0] ?? "");
  } catch {
    return null;
  }
}

export type Jugement = { verdict: boolean | null; raison: string; essais: number; usage: Usage };

// Un essai, puis un second si le verdict est illisible. Après deux échecs, le verdict reste null : la réponse
// est comptée comme non jugée, plutôt que d'arrêter toute l'évaluation
export async function juger(llm: Llm, critere: Critere, aJuger: AJuger): Promise<Jugement> {
  const { consigne, donnees } = CRITERES[critere];
  const usage: Usage = { entree: 0, enCache: 0, sortie: 0 };
  let rappel = "";
  for (let essai = 1; essai <= 2; essai++) {
    const resultat = await llm(consigne, donnees(aJuger) + rappel);
    usage.entree += resultat.usage.entree;
    usage.enCache += resultat.usage.enCache;
    usage.sortie += resultat.usage.sortie;
    const lu = Verdict.safeParse(lireJson(resultat.texte));
    if (lu.success) return { verdict: lu.data.verdict === "oui", raison: lu.data.raison, essais: essai, usage };
    rappel = `\n\nAttention : une première réponse était illisible. ${FORMAT}`;
  }
  return { verdict: null, raison: "verdict illisible après deux essais", essais: 2, usage };
}

// Le fichier des verdicts du juge (eval/jugements.json) : un verdict par réponse et par critère, avec sa raison
export const Jugements = z.object({
  date: z.iso.date(),
  juge: z.string(), // le fournisseur et le modèle du juge
  consignes: z.string(), // l'empreinte des consignes du juge : si elles changent, il faut recalibrer
  reponses: z.string(), // le fichier des réponses jugées
  jugements: z.array(
    z.object({ id: z.string(), empreinte: z.string(), critere: z.enum(CRITERES_JUGES), verdict: z.boolean().nullable(), raison: z.string() }),
  ),
});
export type Jugements = z.infer<typeof Jugements>;

export async function lireJugements(fichier = "eval/jugements.json"): Promise<Jugements> {
  const resultat = Jugements.safeParse(JSON.parse(await readFile(fichier, "utf8")));
  if (!resultat.success) throw new Error(`${fichier} invalide :\n${z.prettifyError(resultat.error)}`);
  return resultat.data;
}
