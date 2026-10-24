// Vérifier la réponse avant de la rendre (chapitre 14, leçon 4). Le juge du chapitre 8 vérifie après coup, sur le jeu
// d'évaluation ; ici, c'est Rhéa elle-même, pour chaque réponse, avant que le salarié la lise. Un LLM vérificateur reçoit
// la réponse et tout ce que les outils ont rendu (les passages lus, cités ou non, un solde, une fiche), et dit, affirmation
// par affirmation, si c'est établi, et si l'affirmation est importante : un droit, un montant, un délai, une condition, une
// démarche ou une personne. Une réponse dont une affirmation importante n'est pas établie repart à l'agent, une fois, avec
// ce qui ne va pas ; si elle ne l'est toujours pas, Rhéa s'abstient plutôt que de rendre une information inventée. Un détail
// non établi (un ordre de présentation, une précision de forme) ne coûte pas sa réponse au salarié. Elle est facultative
// (VERIFICATION=oui) : au-dessus du plancher, c'est l'agent qui décide, avec son prompt ; elle ajoute la preuve de chaque
// affirmation, au prix d'un appel de plus
import { z } from "zod";
import type { Llm } from "../llm.ts";
import { demanderJson } from "../recherche/llm-json.ts";

export type Affirmation = { affirmation: string; appuyee: boolean; importante: boolean; raison: string };
// appuyee : toutes les affirmations importantes sont établies (la réponse peut être rendue)
export type Verification = { appuyee: boolean; affirmations: Affirmation[]; illisible?: boolean };

const Lue = z.object({
  affirmations: z.array(
    // importante absente : comptée comme importante (le doute ne profite pas à la réponse)
    z.object({ affirmation: z.string().min(1), raison: z.string(), appuyee: z.boolean(), importante: z.boolean().default(true) }),
  ),
});

const FORMAT = `Réponds uniquement avec un objet JSON : {"affirmations": [{"affirmation": "…", "raison": "ce que tu as vérifié", "appuyee": true ou false, "importante": true ou false}]}`;
export const CONSIGNE_VERIFICATION = `Tu vérifies la réponse d'un assistant RH avant qu'un salarié la lise.
Les passages fournis sont tout ce que l'assistant a lu (cité ou non), avec ce qu'ont rendu ses autres outils ; le passage
« contexte » donne la date du jour et le salarié connecté (son profil : salarie, manager ou rh), qui sont établis.
Découpe la réponse en affirmations sur Kalyo et sur la situation du salarié : une règle, un chiffre, une durée, une condition,
une démarche, un nom, une date.
Pour chacune, dis si les passages l'établissent : "appuyee": true s'ils la disent ou si elle s'en déduit directement (une
reformulation, un calcul simple, une déduction de bon sens : une règle donnée pour l'Union européenne vaut pour l'Allemagne) ;
false si elle n'y figure pas, va au-delà, ou les contredit. N'utilise aucune connaissance extérieure pour établir une règle de
Kalyo, un chiffre ou une date.
Dis aussi si elle est importante : "importante": true si, fausse, elle renseignerait mal le salarié sur un droit, un montant, un
délai, une condition, une démarche ou une personne ; false pour un détail de forme (l'ordre des étapes, une précision sans effet).
Ne compte pas comme affirmations :
- une formule de politesse, une question posée au salarié, une proposition d'aide (« donnez-moi la distance, je ferai le calcul ») ;
- une phrase qui dit ne pas savoir, ne pas pouvoir répondre, ou que la documentation ne précise pas quelque chose ;
- un renvoi vers le service RH, l'espace RH, un ticket ou le manager, et un conseil de démarche qui n'énonce aucune règle
  (« parlez-en à votre manager », « demandez directement à votre collègue ») ;
- ce que dit déjà la question du salarié, ou un fait de culture générale sans chiffre ni règle (la carte grise indique la puissance
  fiscale du véhicule) ;
- les identifiants de passages entre crochets.
Une réponse sans aucune affirmation factuelle (un refus, une abstention) rend une liste vide.
${FORMAT}`;

export type PassageCite = { id: string; texte: string };

export async function verifierReponse(llm: Llm, question: string, reponse: string, passages: PassageCite[]): Promise<Verification> {
  const blocs = passages.map((p) => `<passage source="${p.id}">\n${p.texte}\n</passage>`).join("\n");
  const donnees = `<question>\n${question}\n</question>\n\n<passages>\n${blocs || "(aucun)"}\n</passages>\n\n<reponse>\n${reponse}\n</reponse>`;
  const lu = await demanderJson(llm, CONSIGNE_VERIFICATION, donnees, Lue, FORMAT);
  // Un vérificateur illisible ne bloque pas la réponse (il n'a rien prouvé dans un sens ni dans l'autre) : la trace le dit
  if (!lu) return { appuyee: true, affirmations: [], illisible: true };
  const affirmations = lu.affirmations.map(({ affirmation, appuyee, importante, raison }) => ({ affirmation, appuyee, importante, raison }));
  return { appuyee: affirmations.every((a) => a.appuyee || !a.importante), affirmations };
}

// Ce que l'agent reçoit quand sa réponse n'est pas appuyée : les affirmations importantes en cause, et la consigne de s'en
// tenir aux passages (ou de chercher encore, ou de dire qu'il ne sait pas)
export const relance = (v: Verification) =>
  "Ta réponse contient des affirmations que tes outils n'ont pas établies :\n" +
  v.affirmations
    .filter((a) => !a.appuyee && a.importante)
    .map((a) => `- « ${a.affirmation} » : ${a.raison}`)
    .join("\n") +
  "\nRéécris ta réponse au salarié en t'en tenant à ce que disent les passages, en les citant par leur source exacte. Retire " +
  "ce qu'ils n'établissent pas, ou cherche autrement si l'information manque ; ne commente pas ce message.";

export const ABSTENTION_NON_APPUYEE =
  "Je ne peux pas vous répondre avec certitude : les passages de la documentation que j'ai trouvés ne suffisent pas à établir " +
  "la réponse. Pour une réponse sûre, ouvrez un ticket dans l'espace RH.";
