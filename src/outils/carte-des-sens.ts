// Carte des sens : les questions de la FAQ, projetées en deux dimensions pour voir les sujets proches se regrouper.
// Lancement : npm run carte (écrit carte-des-sens.svg à la racine du projet)
import { readFile, writeFile } from "node:fs/promises";
import { vectoriser } from "../embeddings/fournisseurs.ts";

// 1. Les questions de la FAQ, et un thème pour chacune, qui donnera la couleur du point
const faq = await readFile("corpus/faq/faq-rh.md", "utf8");
const questions = faq.split("\n## ").slice(1).map((bloc) => bloc.split("\n")[0].trim());
const THEMES: [string, RegExp, string][] = [
  ["Télétravail", /télétravail|domicile|jours fixes/i, "#2563eb"],
  ["Congés et absences", /congé|RTT|absence|malade|mariage|PACS|naissance|déménagement/i, "#16a34a"],
  ["Frais et transport", /frais|repas|hôtel|trajets|transport|vélo|titres-restaurant/i, "#d97706"],
  ["Paie et mutuelle", /paie|mutuelle|conjoint|dispensé/i, "#9333ea"],
  ["Autres", /./, "#64748b"],
];
const themeDe = (question: string) => THEMES.find(([, motif]) => motif.test(question))!;

// 2. Un vecteur par question, calculé par le fournisseur d'embeddings choisi dans .env
const vecteurs = await vectoriser(questions, "requete");

// 3. Analyse en composantes principales (ACP) : on cherche les deux directions dans lesquelles
// les points s'étalent le plus, puis on projette chaque vecteur sur ces deux directions
const dim = vecteurs[0].length;
const produit = (a: number[], b: number[]) => a.reduce((somme, x, i) => somme + x * b[i], 0);
const moyenne = Array.from({ length: dim }, (_, j) => vecteurs.reduce((somme, v) => somme + v[j], 0) / vecteurs.length);
const centres = vecteurs.map((v) => v.map((x, j) => x - moyenne[j]));

function directionPrincipale(points: number[][]): number[] {
  let direction = Array.from({ length: dim }, (_, j) => Math.sin(j + 1)); // départ quelconque
  for (let tour = 0; tour < 200; tour++) {
    const projections = points.map((p) => produit(p, direction));
    direction = direction.map((_, j) => points.reduce((somme, p, i) => somme + p[j] * projections[i], 0));
    const longueur = Math.sqrt(produit(direction, direction));
    direction = direction.map((x) => x / longueur);
  }
  return direction;
}
const axe1 = directionPrincipale(centres);
const axe2 = directionPrincipale(centres.map((p) => p.map((x, j) => x - produit(p, axe1) * axe1[j])));
const points = centres.map((p) => [produit(p, axe1), produit(p, axe2)]);

// 4. Dessin en SVG : un point par question, coloré selon son thème
const [L, H, marge] = [1200, 760, 40];
const echelle = (valeurs: number[], debut: number, fin: number) => {
  const [min, max] = [Math.min(...valeurs), Math.max(...valeurs)];
  return (v: number) => debut + ((v - min) / (max - min)) * (fin - debut);
};
const ex = echelle(points.map((p) => p[0]), marge, L - 290); // place à droite pour les libellés
const ey = echelle(points.map((p) => p[1]), marge, H - marge);
const occupes: [number, number][] = []; // libellés déjà placés, pour décaler ceux qui se chevauchent
const libre = (x: number, y: number) => !occupes.some(([ox, oy]) => Math.abs(ox - x) < 250 && Math.abs(oy - y) < 15);
const placer = (x: number, y: number) => {
  let decalage = 0; // on essaie juste au-dessus, puis juste en dessous, puis un peu plus loin
  while (!libre(x, y + decalage)) decalage = decalage > 0 ? -decalage : 15 - decalage;
  occupes.push([x, y + decalage]);
  return y + decalage;
};
const echapper = (texte: string) => texte.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const elements = points.map(([x, y], i) => {
  const [, , couleur] = themeDe(questions[i]);
  const libelle = questions[i].length > 38 ? questions[i].slice(0, 36) + "…" : questions[i];
  const yLibelle = placer(ex(x), ey(y));
  const trait = yLibelle === ey(y) ? "" : // libellé décalé : un trait le relie à son point
    `<line x1="${ex(x).toFixed(1)}" y1="${ey(y).toFixed(1)}" x2="${(ex(x) + 9).toFixed(1)}" y2="${yLibelle.toFixed(1)}" stroke="#94a3b8"/>`;
  return `${trait}<circle cx="${ex(x).toFixed(1)}" cy="${ey(y).toFixed(1)}" r="7" fill="${couleur}"/>` +
    `<text x="${(ex(x) + 10).toFixed(1)}" y="${(yLibelle + 4).toFixed(1)}" font-size="13" fill="#334155">${echapper(libelle)}</text>`;
});
const legende = THEMES.map(([nom, , couleur], i) =>
  `<circle cx="${30 + i * 190}" cy="${H + 20}" r="7" fill="${couleur}"/><text x="${42 + i * 190}" y="${H + 25}" font-size="15" fill="#0f172a">${nom}</text>`);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${L}" height="${H + 45}" font-family="Segoe UI, Arial, sans-serif">` +
  `<rect width="100%" height="100%" fill="#ffffff"/>${elements.join("")}${legende.join("")}</svg>`;
await writeFile("carte-des-sens.svg", svg);
console.log(`${questions.length} questions projetées : carte-des-sens.svg`);
