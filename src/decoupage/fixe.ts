// Découpage à taille fixe : des fenêtres de même taille qui avancent dans le texte, en se chevauchant
import { enCaracteres, type Mesure } from "./mesure.ts";

// Les mots du texte, chacun avec les blancs qui le précèdent : mis bout à bout, ils redonnent le texte exact
const mots = (texte: string) => texte.match(/\s*\S+/g) ?? [];

// Chaque chunk fait au plus `taille` (mesurée en caractères ou en tokens), sans jamais couper un mot.
// Le suivant reprend la fin du précédent, sur au plus `chevauchement`
export function decouperFixe(texte: string, taille: number, chevauchement = 0, mesure: Mesure = enCaracteres): string[] {
  const liste = mots(texte);
  const tailles = liste.map(mesure);
  const chunks: string[] = [];
  let debut = 0;
  while (debut < liste.length) {
    // 1. Avancer mot par mot tant que la fenêtre ne dépasse pas la taille (un mot trop long passe seul)
    let fin = debut;
    let total = 0;
    while (fin < liste.length && (fin === debut || total + tailles[fin] <= taille)) total += tailles[fin++];
    chunks.push(liste.slice(debut, fin).join("").trim());
    if (fin === liste.length) break;
    // 2. Reculer depuis la fin, mot par mot, pour reprendre jusqu'à `chevauchement` dans le chunk suivant
    let reprise = fin;
    let repris = 0;
    while (reprise > debut + 1 && repris + tailles[reprise - 1] <= chevauchement) repris += tailles[--reprise];
    debut = reprise;
  }
  return chunks;
}
