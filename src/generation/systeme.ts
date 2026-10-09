// Le prompt système de Rhéa : un fichier Markdown versionné avec le code, prompts/rhea.md.
// Sa version et son empreinte accompagnent chaque réponse : on sait quel prompt l'a produite
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";

export type PromptSysteme = { version: string; texte: string; empreinte: string };

export async function lirePromptSysteme(fichier = "prompts/rhea.md"): Promise<PromptSysteme> {
  // Un dépôt cloné sous Windows peut avoir des fins de ligne CRLF : on les ramène à LF, pour que le fichier se lise
  // et que l'empreinte soit la même partout. trimStart retire aussi un éventuel BOM laissé par un éditeur
  const contenu = (await readFile(fichier, "utf8")).replaceAll("\r\n", "\n").trimStart();
  // Le fichier commence par un bloc de métadonnées en YAML, entre deux lignes ---, puis vient le prompt
  const morceaux = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(contenu);
  const metadonnees: { version?: unknown } = (morceaux && parse(morceaux[1])) ?? {};
  if (!morceaux || metadonnees.version == null || !morceaux[2].trim()) throw new Error(`${fichier} : il manque le bloc --- version: … --- au début du fichier, ou le texte du prompt`);
  const texte = morceaux[2].trim();
  // L'empreinte change dès qu'un caractère du prompt change, même si l'on oublie de changer la version
  const empreinte = createHash("sha256").update(texte).digest("hex").slice(0, 8);
  return { version: String(metadonnees.version), texte, empreinte };
}
