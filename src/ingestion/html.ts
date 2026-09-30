// Extraction du texte d'une page HTML : on retire ce qui n'est pas le contenu, puis on convertit en Markdown
import * as cheerio from "cheerio";
import TurndownService from "turndown";
import { tables } from "@joplin/turndown-plugin-gfm";

// Ce qui entoure le contenu sur les pages de l'intranet (navigation, bandeau de cookies, scripts) et n'apporte rien à une réponse
const BRUIT = ["script", "style", "header", "nav", "footer", "form", "aside", ".bandeau-cookies"];

const turndown = new TurndownService({ headingStyle: "atx", bulletListMarker: "-" });
turndown.use(tables); // les tableaux restent des tableaux, en Markdown
// Un lien vers une autre page : on garde son texte, pas son adresse
turndown.addRule("liens", { filter: "a", replacement: (contenu) => contenu });

export function htmlVersMarkdown(html: string): string {
  const $ = cheerio.load(html);
  $(BRUIT.join(", ")).remove();
  // Le contenu de la page est dans <main> ; à défaut, on garde tout le <body>
  const contenu = $("main").html() ?? $("body").html() ?? "";
  return turndown.turndown(contenu).trim();
}
