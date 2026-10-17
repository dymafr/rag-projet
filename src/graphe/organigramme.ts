// L'organigramme de Kalyo est déjà un graphe : chaque salarié pointe vers son manager (la colonne manager de la table
// salaries). Pas besoin d'une base de graphes pour le parcourir : une requête récursive (WITH RECURSIVE) remonte ou
// descend les liens dans PostgreSQL. Ces informations sont celles de l'annuaire interne (nom, poste, service, site,
// manager) : jamais un solde, un salaire ni une absence
import type { Base } from "../stockage/base.ts";

export type Personne = {
  matricule: string;
  prenom: string;
  nom: string;
  poste: string;
  service: string;
  site: string;
  manager: string | null;
};

const COLONNES = "matricule, prenom, nom, poste, service, site, manager";

export const nomComplet = (p: Pick<Personne, "prenom" | "nom">) => `${p.prenom} ${p.nom}`;

// La chaîne hiérarchique : la personne (niveau 0), son manager (1), le manager de son manager (2)… jusqu'à la direction.
// CYCLE arrête la remontée si une erreur de saisie fait boucler la chaîne (A manage B qui manage A) : sans lui, la
// requête tournerait sans fin
export async function chaine(base: Base, matricule: string): Promise<(Personne & { niveau: number })[]> {
  const { rows } = await base.query<Personne & { niveau: number }>(
    `WITH RECURSIVE chaine AS (
       SELECT ${COLONNES}, 0 AS niveau FROM salaries WHERE matricule = $1
       UNION ALL
       SELECT s.matricule, s.prenom, s.nom, s.poste, s.service, s.site, s.manager, c.niveau + 1
         FROM salaries s JOIN chaine c ON s.matricule = c.manager
     ) CYCLE matricule SET boucle USING chemin
     SELECT ${COLONNES}, niveau FROM chaine WHERE NOT boucle ORDER BY niveau`,
    [matricule],
  );
  return rows;
}

// Dans l'autre sens : l'équipe directe d'un manager, et le nombre de personnes sous lui, directement ou non (DISTINCT :
// chacune comptée une fois, même si une boucle la fait apparaître par deux chemins)
export async function equipe(base: Base, matricule: string): Promise<{ directs: Personne[]; total: number }> {
  const { rows: directs } = await base.query<Personne>(
    `SELECT ${COLONNES} FROM salaries WHERE manager = $1 ORDER BY nom, prenom`,
    [matricule],
  );
  const { rows } = await base.query<{ total: number }>(
    `WITH RECURSIVE sous AS (
       SELECT matricule FROM salaries WHERE manager = $1
       UNION ALL
       SELECT s.matricule FROM salaries s JOIN sous ON s.manager = sous.matricule
     ) CYCLE matricule SET boucle USING chemin
     SELECT count(DISTINCT matricule)::int AS total FROM sous WHERE NOT boucle`,
    [matricule],
  );
  return { directs, total: rows[0].total };
}

// Sans accents ni majuscules : « Guerin » trouve « Guérin »
const simplifier = (texte: string) => texte.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

// Trouver une personne par son matricule, son nom, ou son prénom et son nom. La table est petite (180 lignes) : on la
// lit en entier et on compare sans accents, au début des mots (« Eva » ne trouve pas « Chevalier »). Plusieurs
// personnes peuvent porter le même nom : on les rend toutes
export async function trouver(base: Base, texte: string): Promise<Personne[]> {
  const cherche = simplifier(texte);
  if (/^k\d{4}$/.test(cherche)) {
    const { rows } = await base.query<Personne>(`SELECT ${COLONNES} FROM salaries WHERE matricule = $1`, [cherche.toUpperCase()]);
    return rows;
  }
  const { rows } = await base.query<Personne>(`SELECT ${COLONNES} FROM salaries ORDER BY nom, prenom`);
  const exacts = rows.filter((p) => [simplifier(nomComplet(p)), simplifier(`${p.nom} ${p.prenom}`)].includes(cherche));
  if (exacts.length > 0) return exacts;
  return rows.filter((p) => simplifier(p.nom) === cherche || ` ${simplifier(nomComplet(p))}`.includes(` ${cherche}`));
}

export type Verification = { racines: Personne[]; managersInconnus: Personne[]; boucles: string[][] };

// Vérifier le graphe avant de s'en servir : les personnes sans manager (la direction), les managers qui n'existent
// pas dans la table, et les boucles. Un organigramme se corrige dans le SIRH, pas dans Rhéa : on signale seulement
export async function verifier(base: Base): Promise<Verification> {
  const { rows } = await base.query<Personne>(`SELECT ${COLONNES} FROM salaries ORDER BY matricule`);
  const parMatricule = new Map(rows.map((p) => [p.matricule, p]));
  const boucles: string[][] = [];
  const dansUneBoucle = new Set<string>();
  for (const depart of rows) {
    const vus: string[] = [];
    let courant: Personne | undefined = depart;
    while (courant && !vus.includes(courant.matricule) && !dansUneBoucle.has(courant.matricule)) {
      vus.push(courant.matricule);
      courant = courant.manager ? parMatricule.get(courant.manager) : undefined;
    }
    // La remontée revient sur une personne déjà vue : la boucle commence là
    if (courant && vus.includes(courant.matricule)) {
      const boucle = vus.slice(vus.indexOf(courant.matricule));
      boucle.forEach((m) => dansUneBoucle.add(m));
      boucles.push(boucle);
    }
  }
  return {
    racines: rows.filter((p) => p.manager === null),
    managersInconnus: rows.filter((p) => p.manager !== null && !parMatricule.has(p.manager)),
    boucles,
  };
}
