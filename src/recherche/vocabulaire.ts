// Le vocabulaire de Kalyo : sigles, abréviations et synonymes. La recherche plein texte ne connaît que les mots écrits :
// « tt » ne trouve pas « télétravail », ni « mutuelle » « complémentaire santé ». On enrichit donc la requête avec les
// autres façons de dire la même chose, avant de la chercher
export const LEXIQUE: string[][] = [
  // Chaque groupe réunit des formes équivalentes, celle des documents d'abord
  ["télétravail", "tt"],
  ["congés payés", "cp"],
  ["réduction du temps de travail", "rtt"],
  ["note de frais", "ndf"],
  ["enfant malade", "ema"],
  ["événement familial", "evf"],
  ["congé sans solde", "css"],
  ["comité social et économique", "cse"],
  ["compte personnel de formation", "cpf"],
  ["reconnaissance de la qualité de travailleur handicapé", "rqth"],
  ["voiture de transport avec chauffeur", "vtc"],
  ["complémentaire santé", "mutuelle"],
  ["titres-restaurant", "tickets resto"],
  ["repas", "déjeuner", "dej"],
  ["ergonomique", "ergo"],
];

// Pour comparer sans tenir compte des majuscules ni des accents : « Télétravail » et « teletravail » s'écrivent pareil
const simplifier = (texte: string) => texte.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// Une forme est présente si elle apparaît en mots entiers : « cp » est dans « des cp ? », pas dans « cpf »
const presente = (forme: string, question: string) => {
  const motif = simplifier(forme).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${motif}($|[^\\p{L}\\p{N}])`, "u").test(question);
};

// La question, suivie des formes équivalentes à celles qu'elle contient : « tt c'est combien ? » devient
// « tt c'est combien ? (télétravail) ». Une question sans terme du lexique reste telle quelle
export function enrichir(question: string, lexique = LEXIQUE): string {
  const q = simplifier(question);
  const ajouts = lexique.flatMap((groupe) => (groupe.some((forme) => presente(forme, q)) ? groupe.filter((forme) => !presente(forme, q)) : []));
  return ajouts.length > 0 ? `${question} (${ajouts.join(", ")})` : question;
}
