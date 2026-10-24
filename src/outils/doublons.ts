// Les questions presque identiques (chapitre 14, leçon 2) : dans le jeu de travail (deux fois la même question ne mesurent
// qu'une chose), et surtout entre le jeu de travail et le jeu caché. Une question cachée qui reprend une question de
// travail en d'autres mots ne vérifie plus rien : Rhéa a été réglée dessus. On compare les vecteurs des questions (le
// modèle d'embedding de .env, local par défaut) : au-delà du seuil, la paire est à examiner, pas forcément à jeter.
// Lancement : npm run eval:doublons -- [--seuil 0.9] [--paires-cachees]
// Du jeu caché, rien ne s'affiche que le nombre de paires. Son auteur seul lance --paires-cachees, qui donne les
// identifiants : savoir quelle question de travail ressemble à une question cachée, c'est déjà savoir de quoi elle parle
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { vectoriser } from "../embeddings/fournisseurs.ts";
import { produitScalaire } from "../embeddings/similarite.ts";
import { JEU_CACHE, JEU_DE_TRAVAIL, lireJeuProduction, type QuestionProduction } from "../eval/production.ts";

const { values } = parseArgs({ options: { seuil: { type: "string", default: "0.9" }, "paires-cachees": { type: "boolean", default: false } } });
const seuil = Number(values.seuil);
if (!(seuil > 0 && seuil < 1)) throw new Error("--seuil attend un nombre entre 0 et 1, par exemple --seuil 0.9");

// Ce qu'on compare : la question, précédée de la dernière question de l'historique (« Et à Nantes ? » seule ne dit rien)
const texte = (q: QuestionProduction) => [q.historique?.at(-1)?.question, q.question].filter(Boolean).join(" / ");
const travail = (await lireJeuProduction(JEU_DE_TRAVAIL)).questions;
const cache = existsSync(JEU_CACHE) ? (await lireJeuProduction(JEU_CACHE)).questions : [];
const vecteurs = await vectoriser([...travail, ...cache].map(texte), "requete"); // normalisés : le produit scalaire est le cosinus
const vT = vecteurs.slice(0, travail.length);
const vC = vecteurs.slice(travail.length);

const paires = (a: number[][], b: number[][], meme: boolean) => {
  const trouvees: { i: number; j: number; cosinus: number }[] = [];
  for (let i = 0; i < a.length; i++) {
    for (let j = meme ? i + 1 : 0; j < b.length; j++) {
      const c = produitScalaire(a[i], b[j]);
      if (c >= seuil) trouvees.push({ i, j, cosinus: c });
    }
  }
  return trouvees.sort((x, y) => y.cosinus - x.cosinus);
};

const dansTravail = paires(vT, vT, true);
console.log(`Jeu de travail : ${dansTravail.length} paire(s) au-dessus de ${seuil}`);
// Deux questions identiques peuvent mesurer deux choses : à deux dates (une règle qui a changé), ou pour deux profils
// (couverte pour l'un, interdite pour l'autre). On le dit, pour ne pas les prendre pour des doublons
const voulue = (a: QuestionProduction, b: QuestionProduction) =>
  [a.date !== b.date && "dates différentes", a.profil !== b.profil && "profils différents", a.enVigueurLe !== b.enVigueurLe && "périodes différentes"].filter(Boolean).join(", ");
for (const { i, j, cosinus } of dansTravail) {
  const pourquoi = voulue(travail[i], travail[j]);
  console.log(`  ${cosinus.toFixed(3)}  ${travail[i].id} « ${travail[i].question} »  ~  ${travail[j].id} « ${travail[j].question} »${pourquoi ? `  (${pourquoi})` : ""}`);
}
if (cache.length > 0) {
  const entre = paires(vC, vT, false);
  console.log(`\nJeu caché face au jeu de travail : ${entre.length} paire(s) au-dessus de ${seuil}`);
  if (values["paires-cachees"]) for (const { i, j, cosinus } of entre) console.log(`  ${cosinus.toFixed(3)}  ${cache[i].id} (caché)  ~  ${travail[j].id}`);
  process.exitCode = entre.length > 0 ? 1 : 0;
}
