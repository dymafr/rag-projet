// La minimisation (chapitre 13, leçon 3) : n'indexer que ce qui sert à répondre. Un numéro de téléphone, une adresse
// électronique, un IBAN, un numéro de sécurité sociale ou le nom d'un collègue n'aident pas Rhéa à expliquer une règle ;
// indexés, ils pourraient ressortir dans une réponse, et il faudrait les effacer partout. On les masque dans le texte des
// tickets, avant le découpage. Ce qui reste (une maladie, une situation familiale) fait souvent le sens de la question :
// on le garde, et seul le service RH lit les tickets (leçon 1). Un ticket masqué reste une donnée personnelle : c'est
// une pseudonymisation, pas une anonymisation (le contexte, les dates, le poste suffisent souvent à retrouver la personne)
import { readFile } from "node:fs/promises";

// Les motifs, du plus long au plus court : un IBAN contient des suites de chiffres qu'un autre motif prendrait
export const MASQUES: [nom: string, motif: RegExp, remplacement: string][] = [
  ["IBAN", /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g, "[IBAN]"], // FR76 3000 6000 0112…, DE89 3704… ; en majuscules (« vol AF12 vers Lyon » n'en est pas un)
  ["sécurité sociale", /\b[12] ?\d{2} ?(?:0[1-9]|1[0-2]) ?(?:\d{2}|2[AB]) ?\d{3} ?\d{3}(?: ?\d{2})?\b/g, "[n° de sécurité sociale]"],
  ["adresse électronique", /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[adresse électronique]"],
  ["téléphone", /(?:\+33 ?|\b0)\d(?:[ .]?\d{2}){4}\b/g, "[téléphone]"],
];

// Les noms complets des salariés, lus dans l'annuaire (corpus/soldes/soldes.sql, chapitre 10) : « Prénom Nom ». Un
// prénom seul reste (« Claire » ne désigne personne de façon sûre), et le nettoyage du chapitre 4 retire la signature
export async function lireAnnuaire(chemin = "corpus/soldes/soldes.sql"): Promise<string[]> {
  const sql = await readFile(chemin, "utf8");
  return [...sql.matchAll(/\('K\d{4}', '((?:[^']|'')+)', '((?:[^']|'')+)'/g)].map(([, prenom, nom]) => `${prenom} ${nom}`.replaceAll("''", "'"));
}

const echapper = (texte: string) => texte.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Le texte masqué, et le nombre de masques posés par catégorie (pour le bilan : rien n'est affiché du texte d'origine)
export function masquer(texte: string, noms: string[] = []): { texte: string; masques: Record<string, number> } {
  const masques: Record<string, number> = {};
  const compter = (nom: string) => (masques[nom] = (masques[nom] ?? 0) + 1);
  let resultat = texte;
  for (const [nom, motif, remplacement] of MASQUES) resultat = resultat.replace(motif, () => (compter(nom), remplacement));
  if (noms.length > 0) {
    // Un seul motif pour tous les noms, les plus longs d'abord, sans lettre collée avant ou après
    const tous = new RegExp(`(?<!\\p{L})(?:${[...noms].sort((a, b) => b.length - a.length).map(echapper).join("|")})(?!\\p{L})`, "gu");
    resultat = resultat.replace(tous, () => (compter("nom"), "[nom]"));
  }
  return { texte: resultat, masques };
}
