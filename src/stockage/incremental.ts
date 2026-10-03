// L'indexation incrémentale : comparer les chunks voulus à ceux de la base, puis ne faire que la différence
import type { Base } from "./base.ts";
import { METADONNEES } from "./chunks.ts";

// Ce que la base sait déjà d'un chunk, et ce qu'on en attend : son id et ses deux empreintes
export type Empreintes = { id: string; empreinte: string; empreinte_meta: string };

export function planifier<Voulu extends Empreintes>(voulus: Voulu[], enBase: Empreintes[]) {
  const existants = new Map(enBase.map((ligne) => [ligne.id, ligne]));
  const ids = new Set(voulus.map((voulu) => voulu.id));
  // Nouveau chunk, ou texte modifié : il faut calculer son vecteur
  const aVectoriser = voulus.filter((voulu) => existants.get(voulu.id)?.empreinte !== voulu.empreinte);
  // Même texte, autres métadonnées : on les réécrit, et le vecteur reste
  const aMettreAJour = voulus.filter((voulu) => {
    const existant = existants.get(voulu.id);
    return existant?.empreinte === voulu.empreinte && existant.empreinte_meta !== voulu.empreinte_meta;
  });
  // Dans la base, mais plus dans les chunks : le document a été supprimé, ou découpé autrement
  const aSupprimer = enBase.filter((ligne) => !ids.has(ligne.id)).map((ligne) => ligne.id);
  return { aVectoriser, aMettreAJour, aSupprimer, inchanges: voulus.length - aVectoriser.length - aMettreAJour.length };
}

// Réécrit les métadonnées d'un chunk (valeurs dans l'ordre de METADONNEES), sans toucher au texte ni au vecteur
export async function mettreAJour(base: Base, id: string, valeurs: unknown[], empreinteMeta: string, table = "chunks") {
  const colonnes = [...METADONNEES, "empreinte_meta"].map((colonne, i) => `${colonne} = $${i + 2}`).join(", ");
  await base.query(`UPDATE ${table} SET ${colonnes} WHERE id = $1`, [id, ...valeurs, empreinteMeta]);
}

export async function supprimer(base: Base, ids: string[], table = "chunks") {
  if (ids.length > 0) await base.query(`DELETE FROM ${table} WHERE id = ANY($1)`, [ids]);
}
