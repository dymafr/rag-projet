// Ranger les chunks dans PostgreSQL : une ligne par chunk, avec les métadonnées de son document et son vecteur
import pgvector from "pgvector/pg";
import type { Chunk } from "../decoupage/chunk.ts";
import { texteAVectoriser } from "../decoupage/contexte.ts";
import { empreinte, type Document } from "../ingestion/document.ts";
import type { Base } from "./base.ts";

// Les colonnes qui viennent des métadonnées du document : elles peuvent changer sans que le texte change
export const METADONNEES = ["type", "acces", "langue", "sites", "date_effet", "date_fin"];
const COLONNES = ["id", "document", "titres", "texte", "taille", ...METADONNEES, "empreinte", "empreinte_meta", "embedding"];

// La fin de validité d'un document : la date d'effet du texte qui le remplace (remplace_par, relié au chapitre 4).
// null si aucun texte ne le remplace : il est toujours en vigueur
export function dateDeFin(document: Document, documents: Map<string, Document>): string | null {
  const remplacant = document.metadonnees.remplace_par;
  if (!remplacant) return null;
  return documents.get(remplacant)?.metadonnees.date_effet ?? null;
}

// Les valeurs des colonnes de métadonnées, dans l'ordre de METADONNEES
export function metadonnees(document: Document, dateFin: string | null): unknown[] {
  const m = document.metadonnees;
  return [m.type, m.acces, m.langue, m.site, m.date_effet, dateFin];
}

// Deux empreintes (chapitre 4) : celle du texte qu'on vectorise, et celle des métadonnées.
// Si la première change, il faut un nouveau vecteur. Si seule la seconde change, une mise à jour suffit
export function empreintes(chunk: Chunk, document: Document, dateFin: string | null) {
  return {
    empreinte: empreinte(texteAVectoriser(chunk)),
    empreinte_meta: empreinte(JSON.stringify(metadonnees(document, dateFin))),
  };
}

// Les valeurs d'une ligne, dans l'ordre des colonnes. Le vecteur s'écrit comme pgvector l'attend : « [0.01,-0.02,…] »
export function ligne(chunk: Chunk, document: Document, vecteur: number[], dateFin: string | null): unknown[] {
  const e = empreintes(chunk, document, dateFin);
  const debut = [chunk.id, chunk.document, chunk.titres, chunk.texte, chunk.taille];
  return [...debut, ...metadonnees(document, dateFin), e.empreinte, e.empreinte_meta, pgvector.toSql(vecteur)];
}

// Les paramètres numérotés d'un lot de lignes : ($1, $2, $3), ($4, $5, $6)…
export function parametres(lignes: number, colonnes: number): string {
  const numeros = (i: number) => Array.from({ length: colonnes }, (_, j) => `$${i * colonnes + j + 1}`).join(", ");
  return Array.from({ length: lignes }, (_, i) => `(${numeros(i)})`).join(", ");
}

// Une requête par lot, au lieu d'une par ligne : moins d'allers-retours avec la base. Un chunk déjà présent
// (même id) est remplacé : c'est un « upsert », insertion ou mise à jour. Rend le nombre de requêtes envoyées
// PostgreSQL accepte au plus 65 535 paramètres par requête : à 100 lignes par lot, on en reste loin
export async function insererParLots(base: Base, lignes: unknown[][], taille = 100, table = "chunks"): Promise<number> {
  const remplacer = COLONNES.slice(1).map((colonne) => `${colonne} = EXCLUDED.${colonne}`).join(", ");
  let requetes = 0;
  for (let debut = 0; debut < lignes.length; debut += taille) {
    const lot = lignes.slice(debut, debut + taille);
    await base.query(
      `INSERT INTO ${table} (${COLONNES.join(", ")}) VALUES ${parametres(lot.length, COLONNES.length)}
       ON CONFLICT (id) DO UPDATE SET ${remplacer}`,
      lot.flat(),
    );
    requetes++;
  }
  return requetes;
}
