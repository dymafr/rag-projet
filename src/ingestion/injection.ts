// Les consignes cachées dans les documents (chapitre 13, leçon 2). Un ticket est écrit par un salarié : n'importe qui
// peut y glisser une phrase adressée à l'assistant, que Rhéa lira plus tard avec les droits d'une autre personne. Deux
// traitements à l'ingestion. Retirer les caractères invisibles, qui cachent un texte à l'œil, pas au LLM. Repérer les
// phrases qui parlent à l'assistant : un signal pour un humain, pas une barrière, car une consigne se reformule à
// l'infini (une autre langue, une faute volontaire, un encodage). La barrière est ailleurs : ce que l'agent ne peut plus
// faire après avoir lu un ticket (agent/boucle.ts)

// Les caractères qu'Unicode déclare ignorables à l'affichage (propriété Default_Ignorable_Code_Point) : largeur nulle,
// trait d'union conditionnel, contrôles d'écriture, sélecteurs de variante et leur supplément, « tag », remplisseurs…
const INVISIBLES = /\p{Default_Ignorable_Code_Point}/gu; // rien à l'écran, des tokens pour le LLM
export const retirerInvisibles = (texte: string) => texte.replace(INVISIBLES, "");

// Les formes connues d'une consigne adressée à l'assistant, en français et en anglais : « tes consignes », « les consignes
// précédentes ». Sur les tickets du corpus, seul le ticket piégé y répond (test/injection.test.ts). Une phrase banale,
// « mon manager ignore les règles », n'y répond pas : un faux positif écarterait la demande d'un vrai salarié
export const REGLES: Record<string, RegExp> = {
  "consignes écartées": /\b(?:ignore|oublie|disregard|forget)[sz]?\s+(?:(?:tes|vos|your|previous|prior|toutes? (?:tes|vos)|(?:all|the) (?:your|previous|prior|above))\s+(?:\p{L}+\s+)?(?:consignes?|instructions?|r[eè]gles?)|(?:(?:toutes? )?les|the|all|any)\s+(?:consignes?|instructions?|r[eè]gles?)\s+(?:pr[eé]c[eé]dentes?|previous|prior|above|ci-dessus))\b/iu,
  "rôle usurpé": /(?:^assistant|(?:\n|[.!?]\s+)(?:assistant|syst[eè]me|system|rh[eé]a))\s*:/iu, // au début du sujet, « assistant » seul
  "balises de conversation": /<\|im_(?:start|end)\|>|\[\/?INST\]|<\/?(?:system|assistant)>|<start_of_turn>/iu,
  "document réclamé en entier": /(?<!\bs['’])\b(?:cit|affich|recopi|r[eé]v[eè]l|reveal|print|repeat)\p{L}*\b[^.!?\n]{0,40}\b(?:int[eé]gral\p{L}*|en entier|mot pour mot|verbatim|in full)\b/iu,
};

// Les règles auxquelles un texte répond : aucune, le plus souvent
export const reperer = (texte: string): string[] => Object.keys(REGLES).filter((nom) => REGLES[nom].test(texte));
