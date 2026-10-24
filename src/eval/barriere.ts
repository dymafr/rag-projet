// La règle de la barrière de qualité et sa décision (chapitre 14, leçon 5). Deux juges de deux fournisseurs jugent
// chaque réponse du jeu caché, et une question ne compte comme réussie que si les deux l'acceptent. Chaque juge se trompe
// surtout dans un sens (leçon 4 : Luna rejette des réponses justes, Haiku en accepte de fausses) ; leur accord ne laisse
// presque rien passer à tort, au prix de quelques réponses justes comptées en échec. Ces désaccords, quelqu'un qui n'a
// pas réglé Rhéa peut les trancher (une relecture indépendante) : le développeur n'en voit que des comptes
import { z } from "zod";
import type { ResultatQuestion } from "./production.ts";

export const REGLE = "eval/production/barriere.json";
export const A_RELIRE = "eval/production/a-relire"; // hors de git : les désaccords du jeu caché, pour le seul relecteur

const Juge = z.string().regex(/^(anthropic|openai|ollama):\S+$/, "un juge s'écrit fournisseur:modèle");
export const Regle = z.strictObject({
  echecsPermis: z.number().int().min(0), // au plus tant d'échecs sur le jeu caché
  nonJugeesPermises: z.number().int().min(0), // une question non jugée (juge illisible, panne) ne compte pas comme réussie
  juges: z.tuple([Juge, Juge]).refine(([a, b]) => a.split(":")[0] !== b.split(":")[0], "deux juges de deux fournisseurs différents"),
  attaques: z.boolean(), // le jeu d'attaques doit passer aussi
});
export type Regle = z.infer<typeof Regle>;

// « openai:gpt-6-luna » : le fournisseur, puis le modèle (qui peut contenir « : », comme gemma4:e4b)
export function lireJuge(juge: string) {
  const [fournisseur, ...modele] = Juge.parse(juge).split(":");
  return { fournisseur: fournisseur as "anthropic" | "openai" | "ollama", modele: modele.join(":") };
}

// Les comptes de deux juges sur les mêmes réponses. Non jugée : l'un des deux n'a pas rendu de verdict
export type Accord = { reussies: number; echouees: number; desaccords: number; nonJugees: number };
export function accordDe(resultats: ResultatQuestion[]): Accord {
  const accord: Accord = { reussies: 0, echouees: 0, desaccords: 0, nonJugees: 0 };
  for (const r of resultats) {
    const [a, b] = [r.verdict.reussie, r.verdictSecond?.reussie ?? null];
    if (a === null || b === null) accord.nonJugees++;
    else if (a !== b) accord.desaccords++;
    else if (a) accord.reussies++;
    else accord.echouees++;
  }
  return accord;
}

// Décider. Ce qui n'est pas tranché compte comme un échec : un désaccord, une question non jugée. La relecture, si elle a
// eu lieu, donne seulement combien de désaccords elle a jugés réussis ou échoués. relireUtile : la barrière n'est pas
// franchie, mais elle le serait si la relecture acceptait assez de désaccords
export function deciderBarriere(regle: Regle, accord: Accord, relus = { reussies: 0, echouees: 0 }) {
  const aTrancher = accord.desaccords - relus.reussies - relus.echouees;
  if (aTrancher < 0) throw new Error("La relecture a tranché plus de désaccords qu'il n'y en avait");
  const surs = accord.echouees + relus.echouees + accord.nonJugees; // les échecs qu'aucune relecture n'effacera
  const echecs = surs + aTrancher;
  const nonJugeesOk = accord.nonJugees <= regle.nonJugeesPermises;
  const franchie = echecs <= regle.echecsPermis && nonJugeesOk;
  const relireUtile = !franchie && aTrancher > 0 && surs <= regle.echecsPermis && nonJugeesOk;
  return { franchie, echecs, aTrancher, relireUtile, aAccepter: Math.max(0, echecs - regle.echecsPermis) };
}
