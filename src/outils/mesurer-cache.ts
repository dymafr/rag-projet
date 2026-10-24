// Choisir le seuil du cache sémantique (chapitre 14, leçon 6). Deux mesures, sur le jeu de travail :
// - les réponses fausses : pour chaque question documentaire, la plus proche du même profil et du même jour. Au-dessus du
//   seuil, la première recevrait la réponse gardée pour la seconde : fausse si elles n'attendent pas les mêmes passages
//   (« un repas client à Paris » et « à Berlin ») ;
// - le gain : des reformulations de questions du jeu (eval/production/paraphrases.json), qui ont la même réponse. Au-dessus
//   du seuil, le cache les reconnaît.
// Un bon seuil ne donne aucune réponse fausse, et reconnaît assez de reformulations pour valoir la peine. Le gain réel se
// mesure ensuite sur les vraies questions (les observations, leçon 7). Aucun LLM ; le modèle d'embedding de .env
// Lancement : npm run cache:mesurer
import { readFile } from "node:fs/promises";
import { vectoriser } from "../embeddings/fournisseurs.ts";
import { produitScalaire } from "../embeddings/similarite.ts";
import { lireJeuProduction, type QuestionProduction } from "../eval/production.ts";
import { aDesIndices } from "../recherche/filtres-extraits.ts";

const SEUILS = [0.85, 0.88, 0.9, 0.92, 0.94, 0.96, 0.98];

const { questions } = await lireJeuProduction();
// Celles que le cache traite : sans historique, sans date ni type de document cités (api/agent.ts)
const documentaires = questions.filter((q) => q.passages && !q.historique && !aDesIndices(q.question));
const vecteurs = await vectoriser(documentaires.map((q) => q.question), "requete"); // normalisés : le produit scalaire est le cosinus
// La même réponse : les mêmes passages qui répondent (pertinence 2)
const repondent = (q: QuestionProduction) => new Set(Object.entries(q.passages ?? {}).filter(([, n]) => n === 2).map(([id]) => id));
const memeReponse = (a: QuestionProduction, b: QuestionProduction) => {
  const [x, y] = [repondent(a), repondent(b)];
  return x.size === y.size && [...x].every((id) => y.has(id));
};
// Le cache ne compare une question qu'à celles du même profil et du même jour (sa clé)
const memeCle = (a: QuestionProduction, b: QuestionProduction) => a.profil === b.profil && a.date === b.date;

// 1. Pour chaque question, sa plus proche voisine parmi les autres questions que le cache lui servirait
const voisines = documentaires.map((q, i) => {
  let meilleure = { j: -1, cosinus: -1 };
  documentaires.forEach((autre, j) => {
    if (j === i || !memeCle(q, autre)) return;
    const c = produitScalaire(vecteurs[i], vecteurs[j]);
    if (c > meilleure.cosinus) meilleure = { j, cosinus: c };
  });
  return { q, voisine: meilleure.j >= 0 ? documentaires[meilleure.j] : null, cosinus: meilleure.cosinus };
});

// 2. Les reformulations : leur similarité avec la question d'origine, et la question du jeu la plus proche. Si ce n'est pas
// l'origine, et qu'elle n'a pas la même réponse, le cache servirait la mauvaise réponse
const toutes = JSON.parse(await readFile("eval/production/paraphrases.json", "utf8")) as { id: string; paraphrase: string }[];
for (const p of toutes) if (!questions.some((q) => q.id === p.id && q.passages)) throw new Error(`paraphrases.json : ${p.id} n'est pas une question documentaire du jeu de travail`);
// Une reformulation qui cite une date ou un type, ou dont la question d'origine en cite, ne passe pas par le cache
const paraphrases = toutes.filter((p) => !aDesIndices(p.paraphrase) && documentaires.some((q) => q.id === p.id));
const vP = await vectoriser(paraphrases.map((p) => p.paraphrase), "requete");
const reformulations = paraphrases.map((p, k) => {
  const origine = documentaires.find((q) => q.id === p.id)!;
  const candidates = documentaires.map((q, j) => ({ q, c: memeCle(q, origine) ? produitScalaire(vP[k], vecteurs[j]) : -1 }));
  const proche = candidates.sort((a, b) => b.c - a.c)[0];
  return { cosinus: produitScalaire(vP[k], vecteurs[documentaires.indexOf(origine)]), proche: proche.c, juste: memeReponse(proche.q, origine) };
});

console.log(`${documentaires.length} questions documentaires (sans historique, ni date ni type cités), ${paraphrases.length} reformulations (${toutes.length - paraphrases.length} écartées : date ou type cités)\n`);
console.log("seuil   reformulations reconnues   réponses fausses");
for (const seuil of SEUILS) {
  const fausses =
    voisines.filter((v) => v.voisine && v.cosinus >= seuil && !memeReponse(v.q, v.voisine)).length +
    reformulations.filter((r) => r.proche >= seuil && !r.juste).length;
  const reconnues = reformulations.filter((r) => r.proche >= seuil && r.juste).length;
  console.log(`${seuil.toFixed(2)}    ${`${reconnues} / ${paraphrases.length}`.padStart(24)}   ${String(fausses).padStart(16)}`);
}
const pires = voisines.filter((v) => v.voisine && !memeReponse(v.q, v.voisine)).sort((a, b) => b.cosinus - a.cosinus).slice(0, 5);
console.log("\nLes paires les plus proches qui n'ont pas la même réponse (le seuil doit rester au-dessus) :");
for (const v of pires) console.log(`  ${v.cosinus.toFixed(3)}  ${v.q.id} « ${v.q.question} »  ~  ${v.voisine!.id} « ${v.voisine!.question} »`);
