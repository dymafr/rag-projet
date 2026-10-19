// Les chargeurs : chaque fichier du corpus devient un ou plusieurs documents au format commun
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { normaliser, type Document } from "./document.ts";
import { htmlVersMarkdown } from "./html.ts";
import { separerEntete } from "./markdown.ts";
import { lireBalisesMeta, lireEnteteYaml, lireYamlVoisin, metadonneesDuTicket, valider } from "./metadonnees.ts";
import { pdfVersMarkdown } from "./pdf.ts";
import { chargerTickets, texteDuTicket } from "./tickets.ts";

// Les dossiers du corpus à indexer. Les soldes de congés, en SQL, serviront au chapitre 10. Chapitre 12 : scans, où
// npm run scans écrit, à côté de chaque image, sa transcription en Markdown (les images elles-mêmes ne sont pas lues ici)
const DOSSIERS = ["politiques", "accords", "managers", "groupe", "intranet", "faq", "tickets", "scans"];
const FORMATS = [".pdf", ".html", ".md", ".json"];

export async function listerFichiers(racine = "corpus"): Promise<string[]> {
  const fichiers: string[] = [];
  for (const dossier of DOSSIERS) {
    // Un corpus sans document scanné n'a pas de dossier scans ; les autres dossiers, eux, sont obligatoires
    const noms = await readdir(join(racine, dossier)).catch((erreur) => {
      if (dossier === "scans" && erreur.code === "ENOENT") return [];
      throw erreur;
    });
    for (const nom of noms.sort()) {
      if (FORMATS.includes(extname(nom))) fichiers.push(join(racine, dossier, nom));
    }
  }
  return fichiers;
}

// Un document : son identifiant et son titre viennent de ses métadonnées, validées au passage ; le titre normalisé comme le texte
function document(source: string, markdown: string, brutes: unknown): Document {
  const metadonnees = valider(brutes, source);
  return { id: metadonnees.id, source, titre: normaliser(metadonnees.titre), texte: normaliser(markdown), metadonnees: { ...metadonnees, titre: normaliser(metadonnees.titre) } };
}

export async function charger(chemin: string): Promise<Document[]> {
  switch (extname(chemin)) {
    case ".html": {
      const html = await readFile(chemin, "utf8");
      return [document(chemin, htmlVersMarkdown(html), lireBalisesMeta(html))];
    }
    case ".md": {
      const { entete, texte } = separerEntete(await readFile(chemin, "utf8"));
      const brutes = lireEnteteYaml(entete);
      // Chapitre 12 : une transcription faite par un modèle de vision se relit avant d'être crue
      if ((brutes as { relue?: boolean } | null)?.relue === false) console.warn(`${chemin} : transcription pas encore relue (relue: false)`);
      return [document(chemin, texte, brutes)];
    }
    case ".pdf":
      return [document(chemin, await pdfVersMarkdown(chemin), await lireYamlVoisin(chemin))];
    case ".json": {
      // Un fichier de tickets : un document par ticket clos qui a une réponse
      const tickets = (await chargerTickets(chemin)).filter((t) => t.statut === "clos" && t.reponse);
      return tickets.map((t) => {
        const texte = normaliser(texteDuTicket(t)); // les données personnelles se cherchent dans le texte normalisé
        return document(`${chemin}#${t.id}`, texte, metadonneesDuTicket(t, texte));
      });
    }
    default:
      throw new Error(`${chemin} : format non pris en charge`);
  }
}
