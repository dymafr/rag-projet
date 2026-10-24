// Le cache sémantique (chapitre 14, leçon 6) : une question très proche d'une question déjà posée reçoit la même réponse,
// sans LLM ni recherche. Le gain est réel (une réponse en quelques millisecondes, pour le prix d'un embedding), les pièges aussi :
// - le seuil : « plafond d'un hôtel à Paris » et « à Lyon » sont très proches pour un modèle d'embedding, et n'ont pas la
//   même réponse. Il se mesure sur le jeu d'évaluation (npm run cache:mesurer), il ne se devine pas ;
// - les droits : une réponse donnée à un manager ne doit jamais servir à un salarié. Le profil fait partie de la clé ;
// - la fraîcheur : une règle change avec la date, le corpus avec une réindexation, la réponse avec le prompt ou un
//   réglage. La date du jour et une version (prompt, LLM, reclassement, vérification, modèle d'embedding, index) font
//   partie de la clé : une seule change, le cache ne sert plus ;
// - les réponses personnelles : un solde, le nom d'un manager, le site du salarié. Elles ne vont jamais dans le cache
//   (personnelle, ci-dessous)
import pgvector from "pgvector/pg";
import type { Base } from "../stockage/base.ts";

// version : celle du prompt, des LLM, du reclassement, de la vérification, du modèle d'embedding et de l'index
export type Cle = { profil: string; jour: string; version: string };
// Une source telle que l'interface l'affiche (le passage cité, son titre, son texte) : gardée avec la réponse
export type SourceEnCache = { id: string; document: string; titre: string; score: number; texte: string };
export type EnCache = { reponse: string; sources: SourceEnCache[]; similarite: number };

export const schemaCache = (dimension: number) => `
CREATE TABLE IF NOT EXISTS cache_semantique (
  id bigserial PRIMARY KEY,
  profil text NOT NULL,
  jour date NOT NULL,
  version text NOT NULL,
  vecteur vector(${Math.trunc(dimension)}) NOT NULL,
  reponse text NOT NULL,
  sources jsonb NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now()
)`;

// Un cache se jette sans rien perdre : si le modèle d'embedding a changé de dimension (une bascule, leçon 9), la table est
// recréée, sinon ses vecteurs ne se compareraient plus à ceux des nouvelles questions
export async function creerCache(base: Base, dimension: number) {
  const { rows } = await base.query<{ dimension: number }>(
    "SELECT atttypmod AS dimension FROM pg_attribute WHERE attrelid = to_regclass('cache_semantique') AND attname = 'vecteur'",
  );
  if (rows[0] && rows[0].dimension !== Math.trunc(dimension)) await base.query("DROP TABLE cache_semantique");
  await base.query(schemaCache(dimension));
}

// La réponse en cache la plus proche, si elle dépasse le seuil, avec la même clé. Le vecteur de la question est normalisé
// (fournisseurs.ts) : le cosinus est 1 - la distance <=>. Peu de lignes (celles du jour) : pas besoin d'index
export async function chercherEnCache(base: Base, vecteur: number[], cle: Cle, seuil: number): Promise<EnCache | null> {
  const { rows } = await base.query<EnCache>(
    `SELECT reponse, sources, 1 - (vecteur <=> $1) AS similarite FROM cache_semantique
     WHERE profil = $2 AND jour = $3 AND version = $4
     ORDER BY vecteur <=> $1 LIMIT 1`,
    [pgvector.toSql(vecteur), cle.profil, cle.jour, cle.version],
  );
  return rows[0] && rows[0].similarite >= seuil ? { ...rows[0], similarite: Number(rows[0].similarite) } : null;
}

export async function garder(base: Base, vecteur: number[], cle: Cle, reponse: string, sources: SourceEnCache[]) {
  await base.query("INSERT INTO cache_semantique (profil, jour, version, vecteur, reponse, sources) VALUES ($1, $2, $3, $4, $5, $6)", [
    cle.profil,
    cle.jour,
    cle.version,
    pgvector.toSql(vecteur),
    reponse,
    JSON.stringify(sources),
  ]);
}

// Le cache ne garde que le jour : la veille, sa clé ne sert déjà plus
export async function viderLeCache(base: Base, jour: string): Promise<number> {
  const { rows } = await base.query("DELETE FROM cache_semantique WHERE jour < $1 RETURNING id", [jour]);
  return rows.length;
}

// Une réponse personnelle ne va pas dans le cache : elle a demandé un outil qui lit des données du salarié (son solde, sa
// fiche, des statistiques, un calcul, un ticket), elle cite sa fiche de l'organigramme, lue d'office, ou elle en reprend un
// élément : un nom (« votre manager, Sylvain Rousseau, … »), son poste, son service ou son site (« l'accueil de votre site
// de Lyon ouvre à 8 h 30 » ne vaut pas pour un salarié de Nantes). Une question de suite non plus : sa réponse dépend de
// la conversation
export const OUTILS_GENERIQUES = new Set(["chercher_documents"]);
export function personnelle(r: { historique: number; appels: { id: string; nom: string }[]; ficheDOffice: string; texte: string }): boolean {
  if (r.historique > 0) return true;
  if (r.appels.some((a) => a.id !== "organigramme-d-office" && !OUTILS_GENERIQUES.has(a.nom))) return true;
  if (r.texte.includes("[ORGANIGRAMME-")) return true;
  const noms = r.ficheDOffice.match(/\p{Lu}[\p{Ll}'-]+ \p{Lu}[\p{L}'-]+/gu) ?? []; // Prénom Nom
  // La première ligne de la fiche (organigramme.ts) : « Le salarié connecté : Prénom Nom (K0101), poste, service S, site de V. »
  const lui = /Le salarié connecté : [^(]+\([^)]*\), (.+?), service (.+?), site de ([^.\n]+)/u.exec(r.ficheDOffice);
  const texte = r.texte.toLocaleLowerCase("fr");
  return [...noms, ...(lui?.slice(1) ?? [])].some((e) => texte.includes(e.toLocaleLowerCase("fr")));
}
