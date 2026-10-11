// Les réglages de la recherche de Rhéa (chapitre 9). Chaque étape ajoutée au fil du chapitre a le sien ; elle n'entre
// dans RECHERCHE qu'après avoir été mesurée sur le jeu d'évaluation. Ce fichier ne fait que décrire : il ne lit pas .env
// et ne se connecte à rien, les outils et les tests peuvent l'importer sans rien lancer

// vectorielle : les passages les plus proches par le sens (chapitre 6) ; plein-texte : ceux qui contiennent les mots ;
// hybride : les deux, fusionnés par leurs rangs
export const MODES = ["vectorielle", "plein-texte", "hybride"] as const;

export type Reglages = {
  mode: (typeof MODES)[number];
  candidats: number; // les passages que chaque recherche propose à la fusion
  poids: [number, number]; // en hybride : le poids de la recherche vectorielle, puis celui du plein texte (leçon 3)
  vocabulaire: boolean; // enrichir la requête du plein texte avec les sigles et synonymes du lexique (leçon 4)
};

// Les réglages de Rhéa : ceux de l'API et des évaluations, sauf option contraire. Chacun a été choisi sur le jeu
// d'évaluation (voir les leçons) : ce qui n'a pas gagné, ou coûte trop de temps, reste désactivé
export const RECHERCHE: Reglages = { mode: "hybride", candidats: 50, poids: [1, 0.5], vocabulaire: false };
