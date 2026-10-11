// Les réglages de la recherche de Rhéa (chapitre 9). Chaque étape ajoutée au fil du chapitre a le sien ; elle n'entre
// dans RECHERCHE qu'après avoir été mesurée sur le jeu d'évaluation. Ce fichier ne fait que décrire : il ne lit pas .env
// et ne se connecte à rien, les outils et les tests peuvent l'importer sans rien lancer

// vectorielle : les passages les plus proches par le sens (chapitre 6) ; plein-texte : ceux qui contiennent les mots
export const MODES = ["vectorielle", "plein-texte"] as const;

export type Reglages = {
  mode: (typeof MODES)[number];
};

// Les réglages de Rhéa : ceux de l'API et des évaluations, sauf option contraire
export const RECHERCHE: Reglages = { mode: "vectorielle" };
