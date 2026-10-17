// Transcrire les documents scannés de corpus/scans avec le modèle de vision : pour chaque image (.jpg, .png), une
// transcription Markdown à côté (même nom, .md), avec les métadonnées du fichier YAML voisin. Une image déjà transcrite
// et inchangée (même empreinte) n'est pas renvoyée au modèle. Ensuite : relire chaque transcription, passer relue à true,
// puis relancer l'ingestion (npm run ingest, decouper, indexer).
// Lancement : npm run scans [-- --forcer]
import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { parseArgs } from "node:util";
import { lireYamlVoisin } from "../ingestion/metadonnees.ts";
import { aujourdhui } from "../recherche/passages.ts";
import { modeleVision, regarder } from "../vision/regarder.ts";
import { CONSIGNE_TRANSCRIPTION, empreinteImage, empreinteTranscrite, fichierTranscription } from "../vision/transcrire.ts";

const { values } = parseArgs({ options: { forcer: { type: "boolean", default: false } } });
const DOSSIER = "corpus/scans";

for (const nom of (await readdir(DOSSIER)).sort()) {
  if (![".jpg", ".jpeg", ".png"].includes(extname(nom).toLowerCase())) continue;
  const chemin = join(DOSSIER, nom);
  const cible = chemin.replace(/\.(jpe?g|png)$/i, ".md");
  const image = await readFile(chemin);
  const empreinte = empreinteImage(image);
  const existante = await readFile(cible, "utf8").catch(() => null);
  if (!values.forcer && existante && empreinteTranscrite(existante) === empreinte) {
    console.log(`${chemin} : déjà transcrite, image inchangée (${cible})`);
    continue;
  }
  const metadonnees = (await lireYamlVoisin(chemin)) as Record<string, unknown>; // avant le modèle : sans YAML, on s'arrête tout de suite
  const debut = performance.now();
  const texte = await regarder(image, CONSIGNE_TRANSCRIPTION);
  const infos = { image: chemin, empreinte, modele: modeleVision(), date: aujourdhui() };
  await writeFile(cible, fichierTranscription(metadonnees, infos, texte));
  console.log(`${chemin} → ${cible} (${((performance.now() - debut) / 1000).toFixed(1)} s), À RELIRE avant l'ingestion :\n`);
  console.log(texte.trim().replace(/^/gm, "  "));
}
