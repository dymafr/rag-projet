// Les métadonnées d'un document : lues dans chaque format, puis validées par un schéma commun
import { readFile } from "node:fs/promises";
import * as cheerio from "cheerio";
import { parse } from "yaml";
import { z } from "zod";
import { donneesPersonnelles, type Ticket } from "./tickets.ts";

z.config(z.locales.fr()); // messages d'erreur en français

export const Metadonnees = z.object({
  id: z.string().regex(/^[A-Z0-9-]+$/, "majuscules, chiffres et tirets"),
  titre: z.string().min(1),
  type: z.enum(["politique", "accord", "faq", "intranet", "ticket"]),
  date_effet: z.iso.date(), // à partir de quand le document s'applique : 2026-03-01
  remplace: z.string().optional(), // l'identifiant de la version précédente
  remplace_par: z.string().optional(), // ajouté par lierVersions
  acces: z.enum(["tous", "manager", "rh"]), // qui a le droit de lire le document
  langue: z.enum(["fr", "en"]),
  site: z.array(z.enum(["lyon", "nantes"])).min(1),
  categorie: z.string().optional(), // tickets seulement
  donnees_personnelles: z.array(z.string()).optional(), // tickets seulement
});
export type Metadonnees = z.infer<typeof Metadonnees>;

// Valide les métadonnées lues dans un fichier ; en cas d'erreur, dit lesquelles et pourquoi
export function valider(brutes: unknown, source: string): Metadonnees {
  const resultat = Metadonnees.safeParse(brutes);
  if (!resultat.success) throw new Error(`${source} : métadonnées invalides\n${z.prettifyError(resultat.error)}`);
  return resultat.data;
}

// PDF : un fichier YAML voisin, du même nom
export async function lireYamlVoisin(cheminPdf: string): Promise<unknown> {
  const cheminYaml = cheminPdf.replace(/\.pdf$/, ".yaml");
  const yaml = await readFile(cheminYaml, "utf8").catch((erreur) => {
    if (erreur.code === "ENOENT") throw new Error(`${cheminPdf} : métadonnées manquantes (pas de fichier ${cheminYaml})`);
    throw erreur; // une autre erreur de lecture (droits, disque) reste telle quelle
  });
  return parse(yaml);
}

// Markdown : l'en-tête YAML, en haut du fichier
export const lireEnteteYaml = (entete: string): unknown => parse(entete);

// HTML : les balises <meta name="kalyo:…">, et le titre de la page
export function lireBalisesMeta(html: string): unknown {
  const $ = cheerio.load(html);
  const meta = (nom: string) => $(`meta[name="kalyo:${nom}"]`).attr("content");
  return {
    id: meta("id"),
    titre: $("title").text().split(" | ")[0], // « Qui contacter ? | Intranet Kalyo »
    type: meta("type"),
    date_effet: meta("date_effet"),
    acces: meta("acces"),
    langue: meta("langue"),
    site: meta("site")?.split(","),
  };
}

// La langue d'un texte, d'après ses mots les plus courants
const COURANTS = {
  fr: ["le", "la", "les", "de", "des", "et", "est", "pour", "vous", "je"],
  en: ["the", "and", "is", "for", "you", "to", "of", "my", "it", "in"],
};
export function detecterLangue(texte: string): "fr" | "en" {
  const mots = texte.toLowerCase().match(/\p{L}+/gu) ?? [];
  const compter = (liste: string[]) => mots.filter((m) => liste.includes(m)).length;
  return compter(COURANTS.en) > compter(COURANTS.fr) ? "en" : "fr";
}

// Tickets : les champs du ticket. Tant qu'ils ne sont pas anonymisés (chapitre 13), seul le service RH y a accès
export function metadonneesDuTicket(ticket: Ticket, texte: string): unknown {
  return {
    id: ticket.id,
    titre: ticket.sujet,
    type: "ticket",
    date_effet: ticket.date,
    acces: "rh",
    langue: detecterLangue(texte),
    site: [ticket.site],
    categorie: ticket.categorie,
    donnees_personnelles: donneesPersonnelles(texte, ticket),
  };
}

// Les versions : quand un document en remplace un autre, l'ancien reçoit le lien inverse
export function lierVersions(liste: { metadonnees: Metadonnees }[]): void {
  for (const { metadonnees } of liste) {
    const ancien = liste.find((d) => d.metadonnees.id === metadonnees.remplace);
    if (ancien) ancien.metadonnees.remplace_par = metadonnees.id;
  }
}
