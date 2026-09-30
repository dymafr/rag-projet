// Les chargeurs : chaque fichier du corpus devient un ou plusieurs documents au format commun
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { normaliser, type Document } from "./document.ts";
import { htmlVersMarkdown } from "./html.ts";
import { separerEntete } from "./markdown.ts";
import { lireBalisesMeta, lireEnteteYaml, lireYamlVoisin, metadonneesDuTicket, valider } from "./metadonnees.ts";
import { pdfVersMarkdown } from "./pdf.ts";
import { chargerTickets, texteDuTicket } from "./tickets.ts";

// Les dossiers du corpus à indexer. Les soldes de congés, en SQL, serviront au chapitre 10
const DOSSIERS = ["politiques", "accords", "managers", "groupe", "intranet", "faq", "tickets"];
const FORMATS = [".pdf", ".html", ".md", ".json"];

export async function listerFichiers(racine = "corpus"): Promise<string[]> {
  const fichiers: string[] = [];
  for (const dossier of DOSSIERS) {
    for (const nom of (await readdir(join(racine, dossier))).sort()) {
      if (FORMATS.includes(extname(nom))) fichiers.push(join(racine, dossier, nom));
    }
  }
  return fichiers;
}

// Un document : son identifiant et son titre viennent de ses métadonnées, validées au passage
function document(source: string, markdown: string, brutes: unknown): Document {
  const metadonnees = valider(brutes, source);
  return { id: metadonnees.id, source, titre: metadonnees.titre, texte: normaliser(markdown), metadonnees };
}

export async function charger(chemin: string): Promise<Document[]> {
  switch (extname(chemin)) {
    case ".html": {
      const html = await readFile(chemin, "utf8");
      return [document(chemin, htmlVersMarkdown(html), lireBalisesMeta(html))];
    }
    case ".md": {
      const { entete, texte } = separerEntete(await readFile(chemin, "utf8"));
      return [document(chemin, texte, lireEnteteYaml(entete))];
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
