// Les chargeurs : chaque fichier du corpus devient un ou plusieurs documents au format commun
import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { normaliser, type Document } from "./document.ts";
import { htmlVersMarkdown } from "./html.ts";
import { separerEntete } from "./markdown.ts";
import { pdfVersMarkdown } from "./pdf.ts";
import { chargerTickets, donneesPersonnelles, texteDuTicket } from "./tickets.ts";

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

// Le titre : le premier titre « # » du texte, à défaut l'identifiant
const titreDe = (markdown: string, repli: string) => markdown.match(/^# (.+)$/m)?.[1] ?? repli;

export async function charger(chemin: string): Promise<Document[]> {
  const id = basename(chemin, extname(chemin)); // le nom du fichier, sans son extension
  const document = (markdown: string): Document => {
    const texte = normaliser(markdown);
    return { id, source: chemin, titre: titreDe(texte, id), texte, metadonnees: {} };
  };
  switch (extname(chemin)) {
    case ".html":
      return [document(htmlVersMarkdown(await readFile(chemin, "utf8")))];
    case ".md":
      return [document(separerEntete(await readFile(chemin, "utf8")).texte)];
    case ".pdf":
      return [document(await pdfVersMarkdown(chemin))];
    case ".json": {
      // Un fichier de tickets : un document par ticket clos qui a une réponse
      const tickets = (await chargerTickets(chemin)).filter((t) => t.statut === "clos" && t.reponse);
      return tickets.map((t) => {
        const texte = normaliser(texteDuTicket(t));
        const metadonnees = { date: t.date, site: t.site, categorie: t.categorie, donnees_personnelles: donneesPersonnelles(texte, t) };
        return { id: t.id, source: `${chemin}#${t.id}`, titre: t.sujet, texte, metadonnees };
      });
    }
    default:
      throw new Error(`${chemin} : format non pris en charge`);
  }
}
