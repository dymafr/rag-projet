// Recherche sémantique exhaustive, en mémoire : la requête est comparée à chacun des passages
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Embedder } from "../embeddings/fournisseurs.ts";
import { produitScalaire } from "../embeddings/similarite.ts";

export type Passage = { id: string; texte: string };
export type PassageVectorise = Passage & { vecteur: number[] };
export type Resultat = Passage & { score: number };

// Les k passages les plus proches de la requête, du plus proche au moins proche, au-dessus d'un score minimal.
// Les vecteurs sont normalisés : le produit scalaire est la similarité cosinus
export function topK(requete: number[], index: PassageVectorise[], k: number, scoreMin = -1): Resultat[] {
  return index
    .map(({ id, texte, vecteur }) => ({ id, texte, score: produitScalaire(requete, vecteur) }))
    .filter((resultat) => resultat.score >= scoreMin)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// L'empreinte d'un texte : elle change dès qu'un caractère change
const empreinte = (texte: string) => createHash("sha256").update(texte).digest("hex");

// Vectorise les passages en s'appuyant sur un cache disque : seuls les textes nouveaux ou modifiés
// partent au modèle. Le cache dépend du modèle : un autre modèle donne d'autres vecteurs, donc un autre fichier
export async function indexer(passages: Passage[], vectoriser: Embedder, fichierCache: string): Promise<PassageVectorise[]> {
  let cache: Record<string, number[]> = {};
  try {
    cache = JSON.parse(await readFile(fichierCache, "utf8"));
  } catch {
    // pas encore de cache : tout sera calculé
  }
  const manquants = passages.filter((p) => !cache[empreinte(p.texte)]);
  if (manquants.length > 0) {
    const vecteurs = await vectoriser(manquants.map((p) => p.texte), "document");
    manquants.forEach((p, i) => (cache[empreinte(p.texte)] = vecteurs[i]));
    await mkdir(dirname(fichierCache), { recursive: true });
    await writeFile(fichierCache, JSON.stringify(cache));
  }
  return passages.map((p) => ({ ...p, vecteur: cache[empreinte(p.texte)] }));
}
