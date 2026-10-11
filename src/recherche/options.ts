// Les options de recherche des outils d'évaluation (eval:recherche, eval:repondre, npm run eval) : elles changent les
// réglages de Rhéa le temps d'une exécution, pour en comparer d'autres sans toucher au code. Une option booléenne
// s'active par son nom et se désactive par --no- : --vocabulaire, --no-vocabulaire
import { MODES, RECHERCHE, type Reglages } from "./reglages.ts";

export const OPTIONS_RECHERCHE = {
  mode: { type: "string" }, // vectorielle, plein-texte ou hybride
  poids: { type: "string" }, // en hybride : « 1,0.5 », le poids de la recherche vectorielle puis celui du plein texte
  candidats: { type: "string" },
  vocabulaire: { type: "boolean" },
} as const;

// Les valeurs lues par parseArgs : absentes si l'option n'est pas donnée
type Valeurs = {
  mode?: string;
  poids?: string;
  candidats?: string;
  vocabulaire?: boolean;
};

const parmi = <T extends string>(valeur: string, liste: readonly T[], option: string): T => {
  if (!liste.includes(valeur as T)) throw new Error(`--${option} attend ${liste.join(", ")}, pas « ${valeur} »`);
  return valeur as T;
};
// Un nombre écrit en entier : « » ou « 1,» ne valent pas 0 (Number("") vaut 0 en JavaScript)
const nombre = (texte: string) => (texte.trim() === "" ? Number.NaN : Number(texte));

// Les réglages de Rhéa, modifiés par les options données ; une valeur invalide arrête l'outil avec un message, avant
// la première question
export function lireReglages(v: Valeurs): Reglages {
  const r: Reglages = { ...RECHERCHE };
  if (v.mode !== undefined) r.mode = parmi(v.mode, MODES, "mode");
  if (v.poids !== undefined) {
    const poids = v.poids.split(",").map(nombre);
    if (poids.length !== 2 || !poids.every((p) => p >= 0) || poids[0] + poids[1] === 0) {
      throw new Error("--poids attend deux nombres positifs, pas tous deux nuls, par exemple --poids 1,0.5");
    }
    r.poids = [poids[0], poids[1]];
  }
  if (v.candidats !== undefined) {
    r.candidats = nombre(v.candidats);
    if (!Number.isInteger(r.candidats) || r.candidats < 1) throw new Error("--candidats attend un nombre entier positif, par exemple --candidats 20");
  }
  if (v.vocabulaire !== undefined) r.vocabulaire = v.vocabulaire;
  return r;
}

// Les réglages en clair, pour les traces et les enregistrements : « hybride 1/0.5, vocabulaire… »
export function decrire(r: Reglages): string {
  return [
    r.mode === "hybride" ? `hybride ${r.poids.join("/")}` : r.mode,
    r.vocabulaire && r.mode !== "vectorielle" && "vocabulaire",
  ]
    .filter(Boolean)
    .join(", ");
}
