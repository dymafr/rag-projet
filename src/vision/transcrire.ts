// Transcrire un document scanné pour l'indexer (chapitre 12, leçon 4). Deux façons de chercher dans des images : en
// extraire le texte, puis l'indexer comme le reste ; ou indexer l'image elle-même avec des embeddings visuels. Rhéa
// prend la première : ses passages, sa recherche hybride et ses citations restent les mêmes. Le modèle de vision recopie
// le texte en Markdown ; la transcription s'écrit à côté de l'image, avec les métadonnées du document, l'empreinte de
// l'image et le modèle, et relue: false. Une personne la relit et la corrige avant de passer relue à true : un modèle de
// vision peut sauter une ligne ou changer un chiffre sans rien signaler
import { createHash } from "node:crypto";
import { stringify } from "yaml";

export const CONSIGNE_TRANSCRIPTION = `Transcris fidèlement tout le texte de ce document scanné, dans l'ordre de lecture, en Markdown : le titre avec #, puis les paragraphes séparés par une ligne vide.
N'ajoute rien, ne résume rien, ne corrige rien. Un passage illisible : écris [illisible].
Une signature ou un tampon : décris-le entre crochets, [signature : …] ou [tampon : …], avec le nom ou le texte qu'on y lit.`;

export const empreinteImage = (image: Buffer) => createHash("sha256").update(image).digest("hex");

export type InfosTranscription = { image: string; empreinte: string; modele: string; date: string };

// Le fichier Markdown : un en-tête YAML (les métadonnées du document, puis la provenance de la transcription), le texte
export function fichierTranscription(metadonnees: Record<string, unknown>, infos: InfosTranscription, texte: string): string {
  const entete = {
    ...metadonnees,
    source_image: infos.image,
    empreinte_image: infos.empreinte,
    transcrit_par: infos.modele,
    transcrit_le: infos.date,
    relue: false,
  };
  return `---\n${stringify(entete).trim()}\n---\n\n${texte.trim()}\n`;
}

// L'empreinte de l'image transcrite, lue dans l'en-tête d'une transcription existante : inchangée, on ne transcrit pas
export const empreinteTranscrite = (fichier: string) => fichier.match(/^empreinte_image: ([0-9a-f]{64})$/m)?.[1] ?? null;
