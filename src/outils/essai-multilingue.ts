// Essai multilingue : des questions en français, dont la réponse n'existe qu'en anglais
// (la politique voyages du groupe Ostrane). Chaque modèle retrouve-t-il le bon passage ?
// Lancement : npm run multilingue -- [fournisseur:modèle …]
// Sans argument, seul le modèle de .env est testé. Exemple : npm run multilingue -- ollama:<modèle>
import { config, type Config } from "../config.ts";
import { creerEmbedder } from "../embeddings/fournisseurs.ts";
import { produitScalaire } from "../embeddings/similarite.ts";

// Des passages en anglais (politique du groupe) et des passages en français (FAQ de Kalyo) sur des sujets voisins
const passages = [
  { id: "GRP 5.2", texte: "Air travel. The class of service depends on the scheduled flight time: economy under 6 hours, premium economy from 6 to 9 hours. Over 9 hours, premium economy, or business class with director approval." },
  { id: "GRP 7", texte: "Per diems abroad. Employees receive a daily allowance covering meals and small expenses: 60 EUR in Europe, 85 EUR in North America (United States, Canada), 70 EUR in Asia." },
  { id: "GRP 9", texte: "Passports and visas. Check that your passport remains valid for at least 6 months after the planned return date. Visa fees are reimbursed." },
  { id: "GRP 12", texte: "Loyalty programmes. Employees may keep the loyalty points earned on business trips for personal use." },
  { id: "FAQ hôtel", texte: "Le plafond d'une nuit d'hôtel est de 130 € à Paris et de 95 € dans les autres villes, petit déjeuner compris." },
  { id: "FAQ repas", texte: "Le plafond d'un repas avec un client est de 45 € par personne à Paris et de 35 € dans les autres villes." },
  { id: "FAQ voiture", texte: "Les trajets en voiture personnelle sont remboursés selon le barème kilométrique publié chaque année." },
  { id: "FAQ étranger", texte: "Le télétravail depuis l'étranger n'est pas autorisé." },
];
const questions = [
  { texte: "Puis-je voyager en classe affaires sur un vol de huit heures ?", attendu: "GRP 5.2" },
  { texte: "Combien touche-t-on par jour pour une mission au Canada ?", attendu: "GRP 7" },
  { texte: "Mon passeport doit être valable combien de temps ?", attendu: "GRP 9" },
];

// Les modèles à comparer : celui de .env, puis ceux passés en argument sous la forme fournisseur:modèle
type Fournisseur = Config["EMBEDDING_PROVIDER"];
const FOURNISSEURS: Fournisseur[] = ["transformers", "openai", "voyage", "ollama"];
const noms = [`${config.EMBEDDING_PROVIDER}:${config.EMBEDDING_MODEL}`, ...process.argv.slice(2)];
const modeles = noms.map((nom) => {
  const separateur = nom.indexOf(":"); // le nom d'un modèle Ollama peut lui-même contenir « : »
  const [fournisseur, modele] = [nom.slice(0, separateur) as Fournisseur, nom.slice(separateur + 1)];
  if (separateur < 0 || !FOURNISSEURS.includes(fournisseur) || !modele) {
    console.error(`${nom} : attendu fournisseur:modèle, avec un fournisseur parmi ${FOURNISSEURS.join(", ")}`);
    process.exit(1);
  }
  return { nom, fournisseur, modele };
});

for (const { nom, fournisseur, modele } of modeles) {
  const vectoriser = creerEmbedder({ ...config, EMBEDDING_PROVIDER: fournisseur, EMBEDDING_MODEL: modele, EMBEDDING_DIMENSIONS: undefined });

  const vecteurs = await vectoriser(passages.map((p) => p.texte), "document");
  const vQuestions = await vectoriser(questions.map((q) => q.texte), "requete");
  console.log(`\n${nom}`);
  let trouves = 0;
  questions.forEach((q, i) => {
    const classement = passages
      .map((p, j) => ({ id: p.id, score: produitScalaire(vQuestions[i], vecteurs[j]) }))
      .sort((a, b) => b.score - a.score);
    const rang = classement.findIndex((r) => r.id === q.attendu) + 1;
    if (rang === 1) trouves++;
    const tete = classement[0];
    console.log(
      `  ${rang === 1 ? "✔" : "✘"} ${q.texte.padEnd(62)} bon passage au rang ${rang}` +
        (rang === 1 ? ` (${tete.score.toFixed(3)})` : `, en tête : ${tete.id} (${tete.score.toFixed(3)})`),
    );
  });
  console.log(`  ${trouves} sur ${questions.length} en tête`);
}
