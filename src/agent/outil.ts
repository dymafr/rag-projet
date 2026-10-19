// Un outil que le LLM peut appeler : un nom, une description qui lui dit quand s'en servir, des paramètres décrits par un
// schéma zod, et la fonction qui fait le travail. Le LLM ne fait que demander l'appel ; c'est notre code qui l'exécute
import { z } from "zod";
import type { Profil } from "../recherche/droits.ts";
import type { Resultat } from "../recherche/vectorielle.ts";

// Ce que l'application sait de la conversation, et que le LLM ne choisit jamais : la date du jour, le salarié connecté
// (chapitre 10, leçon 3) et son profil, qui décide des documents qu'il peut lire (chapitre 13). Un argument que le LLM
// écrit peut venir d'une question piégée ; le contexte, non
export type Contexte = { date: string; matricule?: string; profil: Profil };

// Ce que rend un outil : un texte pour le LLM et, pour une recherche, les passages trouvés (leurs sources pourront être
// citées, et Claude les reçoit en blocs search_result)
export type ResultatOutil = { texte: string; passages?: Resultat[] };

export type Outil<P extends z.ZodObject = z.ZodObject> = {
  nom: string; // lettres, chiffres et _ : les API refusent les espaces et les accents
  description: string;
  parametres: P;
  executer: (args: z.infer<P>, contexte: Contexte) => Promise<ResultatOutil>;
  // Leçon 5 : un outil qui agit (il crée, modifie, envoie) décrit l'action en une ligne ; la boucle la montre au salarié
  // et attend son accord avant d'exécuter
  aConfirmer?: (args: z.infer<P>) => string;
};

// definirOutil ne fait rien à l'exécution : il garde le lien entre le schéma et les arguments que reçoit executer
export const definirOutil = <P extends z.ZodObject>(outil: Outil<P>): Outil => outil as unknown as Outil;

// Les paramètres en JSON Schema, le format que lisent les API. zod met tous les champs dans required et interdit les
// champs en trop (additionalProperties: false) : c'est ce qu'exige le mode strict d'OpenAI. Un champ facultatif s'écrit
// avec .nullable() : le LLM l'envoie à null. On retire $schema, qui ne sert pas aux API, et les bornes (longueur d'un
// texte, valeur d'un nombre) : le mode strict de Claude les refuse, celui d'OpenAI n'en accepte qu'une partie. Rien n'est
// perdu : la boucle valide les arguments avec le schéma zod complet
const BORNES = new Set(["minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"]);

function sansBornes(schema: Record<string, unknown>): Record<string, unknown> {
  const copie: Record<string, unknown> = {};
  for (const [cle, valeur] of Object.entries(schema)) {
    if (BORNES.has(cle)) continue;
    if (cle === "properties") {
      const proprietes = Object.entries(valeur as Record<string, Record<string, unknown>>);
      copie[cle] = Object.fromEntries(proprietes.map(([nom, s]) => [nom, sansBornes(s)])); // un paramètre peut s'appeler minimum
    } else if (cle === "anyOf") copie[cle] = (valeur as Record<string, unknown>[]).map(sansBornes); // une union, ou un .nullable() sur un enum ou un type borné
    else copie[cle] = valeur;
  }
  return copie;
}

export function schemaJson(outil: Outil): Record<string, unknown> {
  const { $schema, ...schema } = z.toJSONSchema(outil.parametres);
  return sansBornes(schema);
}
