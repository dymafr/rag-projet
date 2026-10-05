// Une réponse structurée : au lieu d'un texte libre, Rhéa renvoie un objet JSON que le programme peut lire et contrôler :
// la réponse, ses sources (numéro du passage et phrase citée) et un niveau de confiance. zod le décrit et le valide
import { z } from "zod";
import type { Usage } from "../llm.ts";

// Le modèle remplit les champs dans l'ordre du schéma : la réponse, puis les phrases qui l'appuient, et la confiance
// en dernier, qui porte sur ce qu'il vient d'écrire. L'ordre inverse, essayé avec notre modèle local, donnait souvent
// le numéro du passage à la place de la phrase citée, même quand la description du champ demandait le texte exact
export const ReponseRhea = z.strictObject({
  reponse: z.string().describe("La réponse au salarié, en texte brut, avec les numéros des passages entre crochets"),
  sources: z
    .array(
      z.strictObject({
        passage: z.number().int().describe("Le numéro du passage cité"),
        citation: z.string().describe("La phrase du passage qui justifie la réponse, recopiée mot pour mot, sans l'abréger"),
      }),
    )
    .describe("Une entrée par passage cité ; une liste vide si les passages ne permettent pas de répondre"),
  confiance: z
    .enum(["haute", "moyenne", "basse"])
    .describe("haute : les passages répondent clairement ; moyenne : ils répondent en partie ; basse : ils répondent mal ou pas du tout"),
});
export type ReponseRhea = z.infer<typeof ReponseRhea>;

// Demander du JSON : l'objet présent (même vide) suffit ; consigne : une phrase ajoutée à la fin du message, au second essai
export type DemandeJson = { consigne?: string };

// 1. Valider le texte reçu : du JSON, conforme au schéma, et dont les sources ne citent que des passages fournis.
// On n'utilise pas parse() des SDK : il lève une exception sur un JSON invalide, et nous voulons réessayer en disant pourquoi
export function valider(texte: string, nombreDePassages: number): { ok: true; reponse: ReponseRhea } | { ok: false; erreur: string } {
  let donnees: unknown;
  try {
    donnees = JSON.parse(texte);
  } catch {
    return { ok: false, erreur: "la réponse n'est pas du JSON valide" };
  }
  const resultat = ReponseRhea.safeParse(donnees);
  if (!resultat.success) return { ok: false, erreur: z.prettifyError(resultat.error) };
  const inconnus = resultat.data.sources.map((s) => s.passage).filter((n) => n < 1 || n > nombreDePassages);
  if (inconnus.length > 0) return { ok: false, erreur: `passage ${inconnus.join(", ")} inexistant : les passages vont de 1 à ${nombreDePassages}` };
  return { ok: true, reponse: resultat.data };
}

// Un appel au LLM qui doit rendre du JSON, avec la consigne du second essai s'il y en a une
export type AppelJson = (consigne?: string) => Promise<{ texte: string; usage: Usage }>;

// 2. Un essai, puis un second si la réponse est invalide. Le LLM ne garde aucun souvenir d'un appel à l'autre :
// le second essai renvoie tout le prompt, plus une phrase qui dit ce qui n'allait pas
export async function repondreEnJson(appeler: AppelJson, nombreDePassages: number) {
  const usage: Usage = { entree: 0, enCache: 0, sortie: 0 };
  let consigne: string | undefined;
  for (let essai = 1; essai <= 2; essai++) {
    const resultat = await appeler(consigne);
    usage.entree += resultat.usage.entree;
    usage.enCache += resultat.usage.enCache;
    usage.sortie += resultat.usage.sortie;
    const validation = valider(resultat.texte, nombreDePassages);
    if (validation.ok) return { reponse: validation.reponse, essais: essai, usage };
    consigne = `Attention : une première réponse à cette question était invalide (${validation.erreur}). Réponds avec un objet JSON conforme au schéma.`;
  }
  throw new Error(`Réponse invalide après deux essais. ${consigne}`);
}
