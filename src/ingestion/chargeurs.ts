// Les chargeurs : chaque fichier du corpus devient un ou plusieurs documents au format commun
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { lireAnnuaire, masquer } from "../rgpd/minimisation.ts";
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
      // Un fichier de tickets : un document par ticket clos qui a une réponse. Chapitre 13 : les coordonnées et les noms
      // des collègues sont masqués, sujet compris (la minimisation), d'après l'annuaire voisin, corpus/soldes/soldes.sql ; sans annuaire
      // (un petit corpus de test), seuls les motifs s'appliquent. Les données personnelles qui restent sont signalées
      const tickets = (await chargerTickets(chemin)).filter((t) => t.statut === "clos" && t.reponse);
      const noms = await lireAnnuaire(join(dirname(dirname(chemin)), "soldes", "soldes.sql")).catch(() => []);
      return tickets.map((t) => {
        const texte = masquer(normaliser(texteDuTicket(t)), noms).texte; // sur le texte normalisé : espaces insécables comprises
        return document(`${chemin}#${t.id}`, texte, metadonneesDuTicket({ ...t, sujet: masquer(normaliser(t.sujet), noms).texte }, texte));
      });
    }
    default:
      throw new Error(`${chemin} : format non pris en charge`);
  }
}
