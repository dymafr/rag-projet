// Le registre des effacements (chapitre 13, leçon 3) : les documents effacés à la demande d'une personne (le droit à
// l'effacement, article 17 du RGPD) ou parce que leur durée de conservation est passée. Il est versionné avec le code et
// ne contient que des identifiants : la preuve qu'on a effacé, sans garder ce qu'on a effacé. L'ingestion l'applique :
// un document encore présent à la source (le temps que l'outil d'origine l'efface aussi) ne revient pas dans l'index
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import type { Base } from "../stockage/base.ts";

export const Effacement = z.strictObject({ id: z.string().regex(/^[A-Z0-9-]+$/), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), motif: z.string().min(1) });
export type Effacement = z.infer<typeof Effacement>;
export const REGISTRE = "effacements.json";

export async function lireEffacements(chemin = REGISTRE): Promise<Effacement[]> {
  let texte: string;
  try {
    texte = await readFile(chemin, "utf8");
  } catch (erreur) {
    if ((erreur as NodeJS.ErrnoException).code === "ENOENT") return []; // pas encore de registre : rien d'effacé
    throw erreur;
  }
  // Un registre illisible, ou d'une autre forme (une liste d'identifiants, un champ mal nommé), arrête tout : mieux vaut
  // ne rien indexer que réindexer un document effacé. Le schéma le vérifie, comme celui du jeu d'attaques
  let brut: unknown;
  try {
    brut = JSON.parse(texte);
  } catch (erreur) {
    throw new SyntaxError(`${chemin} illisible : ${(erreur as Error).message}`);
  }
  const lu = z.array(Effacement).safeParse(brut);
  if (!lu.success) throw new SyntaxError(`${chemin} illisible :\n${z.prettifyError(lu.error)}`);
  return lu.data;
}

// Inscrire un effacement ; un document déjà inscrit ne l'est pas deux fois. true : il vient d'être inscrit
export async function inscrire(effacement: Effacement, chemin = REGISTRE): Promise<boolean> {
  const registre = await lireEffacements(chemin);
  if (registre.some((e) => e.id === effacement.id)) return false;
  await writeFile(chemin, JSON.stringify([...registre, effacement], null, 2) + "\n");
  return true;
}

// Retirer d'un fichier JSONL (documents.jsonl, chunks.jsonl) les lignes d'un document. Le nombre de lignes retirées ;
// 0 si le fichier n'existe pas
export async function retirerDuJsonl(chemin: string, document: string): Promise<number> {
  let lignes: string[];
  try {
    lignes = (await readFile(chemin, "utf8")).split("\n").filter(Boolean);
  } catch {
    return 0;
  }
  // Une ligne de documents.jsonl a pour id le document ; une ligne de chunks.jsonl, un champ document
  const garder = lignes.filter((ligne) => {
    const { id, document: doc } = JSON.parse(ligne) as { id: string; document?: string };
    return (doc ?? id) !== document;
  });
  if (garder.length < lignes.length) await writeFile(chemin, garder.map((l) => `${l}\n`).join(""));
  return lignes.length - garder.length;
}

// Les chunks du document, supprimés de la table. Un DELETE laisse l'ancienne version des lignes dans les fichiers de la
// table : la commande npm run effacer lance ensuite VACUUM (FULL, ANALYZE), qui la réécrit sans elles
export async function effacerDeLaBase(base: Base, document: string): Promise<string[]> {
  const { rows } = await base.query<{ id: string }>("DELETE FROM chunks WHERE document = $1 RETURNING id", [document]);
  return rows.map((r) => r.id).sort();
}
