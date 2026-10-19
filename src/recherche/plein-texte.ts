// Recherche plein texte dans PostgreSQL : les passages qui contiennent les mots de la question, classés par un score de
// type BM25. Elle ne compare pas des sens mais des mots : un code (EMA), un numéro d'article (12.3) ou un nom propre
// (Solvéa) écrit dans la question trouve les passages qui le contiennent (leur rang dépend aussi des autres mots), mais
// un synonyme ou une paraphrase ne trouve rien
import type { Base } from "../stockage/base.ts";
import { conditions, type Filtres, type Resultat } from "./vectorielle.ts";

// Les deux réglages de BM25, à leurs valeurs habituelles. k1 : à quelle vitesse un mot répété cesse de rapporter des
// points. b : combien on corrige la longueur du passage (0 : pas du tout ; 1 : entièrement)
export const K1 = 1.2;
export const B = 0.75;

// La requête SQL et ses valeurs. La question est $1 ; les filtres, les mêmes que ceux de la recherche vectorielle, suivent
export function requetePleinTexte(question: string, k: number, filtres: Filtres) {
  const valeurs: unknown[] = [question];
  const where = ["c.tsv @@ r.mots", ...conditions(filtres, valeurs)].join(" AND ");
  const sql = `
    WITH requete AS (
      -- 1. Les mots de la question ramenés à leur racine, reliés par OU (|) : un passage qui en contient un seul compte.
      -- plainto_tsquery les relie par ET (&) : on remplace « & » entouré d'espaces, l'opérateur, pas un & dans un mot
      SELECT replace(plainto_tsquery('rhea', $1)::text, ' & ', ' | ')::tsquery AS mots
    ),
    frequences AS (
      -- 2. Pour chacun, le nombre de passages qui le contiennent (ndoc) : moins il y en a, plus le mot est discriminant.
      -- ts_stat relit toute la table à chaque question, tous les passages comptés (même ceux que les filtres écartent) :
      -- rien sur quelques centaines de passages ; sur des millions, on calculerait ces nombres à l'indexation. Sous la
      -- sécurité par ligne (chapitre 13), ts_stat et count(*) ne comptent que les passages que le lecteur peut lire
      SELECT word AS lexeme, ndoc FROM ts_stat('SELECT tsv FROM chunks')
      WHERE word IN (SELECT lexeme FROM unnest(to_tsvector('rhea', $1)))
    ),
    collection AS (SELECT count(*) AS n, avg(taille) AS taille_moyenne FROM chunks)
    -- 3. Le score : pour chaque mot de la question présent dans le passage, sa rareté (l'IDF) multipliée par le nombre de
    -- fois qu'il y apparaît, avec une limite (k1) et une correction selon la longueur du passage par rapport à la moyenne (b)
    SELECT c.id, c.document, c.titres, c.texte,
      sum(
        ln(1 + (col.n - f.ndoc + 0.5) / (f.ndoc + 0.5))
        * cardinality(u.positions) * ${K1 + 1}
        / (cardinality(u.positions) + ${K1} * (1 - ${B} + ${B} * c.taille / col.taille_moyenne))
      )::float8 AS score -- float8 : un nombre JavaScript (sinon, un numeric arrive en chaîne)
    FROM chunks c
    CROSS JOIN requete r
    CROSS JOIN collection col
    CROSS JOIN LATERAL unnest(c.tsv) AS u
    JOIN frequences f ON f.lexeme = u.lexeme
    WHERE ${where}
    GROUP BY c.id
    ORDER BY score DESC, c.id
    LIMIT ${Math.trunc(k)}`;
  return { sql, valeurs };
}

// score : le score BM25, qui ne se compare pas à une similarité cosinus (il n'a pas de maximum)
export async function chercherPleinTexte(base: Base, question: string, k: number, filtres: Filtres): Promise<Resultat[]> {
  const { sql, valeurs } = requetePleinTexte(question, k, filtres);
  const { rows } = await base.query<Resultat>(sql, valeurs);
  return rows;
}
