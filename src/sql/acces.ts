// Le text-to-SQL de Rhéa (chapitre 12, leçon 3) : le LLM écrit une requête, PostgreSQL la limite. Trois barrières qui
// ne dépendent pas du LLM : un rôle qui ne peut que lire (rhea_lecture), une seule vue autorisée (soldes_visibles), et la
// sécurité par ligne (row-level security) : un salarié ne voit que sa ligne, un manager celles de son équipe, le
// service RH toutes. La requête la plus habile ne lit rien de plus que ce que la base laisse voir
import type { Base } from "../stockage/base.ts";

export const VUE = "soldes_visibles";

// Idempotent : se relance sans erreur. peut_voir dit si le salarié de la session (rhea.matricule, posé par notre code,
// jamais par le LLM) peut voir la ligne d'un autre : la sienne, celles de toute son équipe (directe ou non : la requête
// récursive de la leçon 2), ou toutes s'il est au service RH. SECURITY DEFINER : elle lit salaries avec les droits de
// son propriétaire, quel que soit l'appelant
export const SCHEMA_ACCES = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rhea_lecture') THEN CREATE ROLE rhea_lecture NOLOGIN; END IF;
END $$;

CREATE OR REPLACE FUNCTION peut_voir(cible text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH RECURSIVE moi AS (
    SELECT matricule, role FROM salaries WHERE matricule = current_setting('rhea.matricule', true)
  ), sous AS (
    SELECT s.matricule FROM salaries s JOIN moi ON s.manager = moi.matricule
    UNION ALL
    SELECT s.matricule FROM salaries s JOIN sous ON s.manager = sous.matricule
  ) CYCLE matricule SET boucle USING chemin
  SELECT EXISTS (SELECT 1 FROM moi WHERE moi.role = 'rh' OR moi.matricule = cible)
      OR EXISTS (SELECT 1 FROM sous WHERE sous.matricule = cible AND NOT boucle)
$$;
REVOKE ALL ON FUNCTION peut_voir(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION peut_voir(text) TO rhea_lecture;

-- Sonde du 17 octobre : SELECT set_config('rhea.matricule', 'K0006', true) dans la requête du LLM changeait de salarié,
-- et la sécurité par ligne suivait. set_config est exécutable par tous (PUBLIC) : on le retire, et on le rend au seul
-- rôle de connexion, qui pose le salarié avant de passer en rhea_lecture
REVOKE EXECUTE ON FUNCTION pg_catalog.set_config(text, text, boolean) FROM PUBLIC;
DO $$ BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION pg_catalog.set_config(text, text, boolean) TO %I', current_user);
END $$;

ALTER TABLE soldes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lecture_soldes ON soldes;
CREATE POLICY lecture_soldes ON soldes FOR SELECT TO rhea_lecture USING (peut_voir(matricule));
-- salaries aussi : la vue la lit avec les droits de rhea_lecture, qui doit donc pouvoir la lire, mais seulement les
-- lignes qu'il a le droit de voir. Sans cette politique, une requête qui atteindrait la table (sonde du 17 octobre :
-- une sous-requête WITH nommée salaries) verrait les 180 salariés
ALTER TABLE salaries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lecture_salaries ON salaries;
CREATE POLICY lecture_salaries ON salaries FOR SELECT TO rhea_lecture USING (peut_voir(matricule));

-- La seule table que voit le LLM : les soldes avec ce qu'il faut pour les regrouper (site, service, équipe). security_invoker :
-- la vue lit les tables avec les droits de celui qui l'interroge, donc avec la sécurité par ligne de rhea_lecture
CREATE OR REPLACE VIEW ${VUE} WITH (security_invoker = true) AS
  SELECT s.matricule, a.prenom, a.nom, a.site, a.service, a.poste, a.manager, a.temps_travail, a.forfait_jours,
         s.cp_reliquat, s.cp_en_cours, s.rtt_acquis, s.rtt_pris, s.rtt_acquis - s.rtt_pris AS rtt_restants, s.maj_le
    FROM soldes s JOIN salaries a USING (matricule);
GRANT SELECT ON soldes, salaries, ${VUE} TO rhea_lecture;
`;

export const preparerAcces = (base: Base) => base.query(SCHEMA_ACCES);

// Ce que voit le salarié de la session, en une phrase : le LLM la reçoit avec les résultats. Sans elle, un « combien »
// calculé sur la seule ligne du salarié ressemblerait à un chiffre de toute l'entreprise
export async function perimetre(base: Base, matricule: string): Promise<string> {
  const { rows } = await base.query<{ role: string; equipe: number }>(
    `WITH RECURSIVE sous AS (
       SELECT matricule FROM salaries WHERE manager = $1
       UNION ALL
       SELECT s.matricule FROM salaries s JOIN sous ON s.manager = sous.matricule
     ) CYCLE matricule SET boucle USING chemin
     SELECT (SELECT role FROM salaries WHERE matricule = $1) AS role, (SELECT count(*)::int FROM sous WHERE NOT boucle) AS equipe`,
    [matricule],
  );
  const { role, equipe } = rows[0] ?? { role: null, equipe: 0 };
  if (role === "rh") return "le salarié connecté est au service RH : il voit les soldes de tous les salariés";
  if (equipe > 0) return `le salarié connecté voit ses propres soldes et ceux de son équipe (${equipe} personnes), et rien d'autre`;
  return "le salarié connecté ne voit que ses propres soldes, aucun autre";
}

export type ResultatSql = { colonnes: string[]; lignes: Record<string, unknown>[]; tronque: boolean };

// Exécuter une requête déjà validée (src/sql/valider.ts), dans une transaction en lecture seule, sous le rôle
// rhea_lecture, avec le salarié de la session et un délai maximal. ROLLBACK à la fin : rien ne reste, même un réglage.
// pool.connect : toutes ces instructions doivent passer par la même connexion. queryMode extended : pg envoie la requête
// en une instruction préparée, que PostgreSQL refuse si elle en contient plusieurs (« COMMIT; DROP … » a contourné
// ainsi le BEGIN READ ONLY du serveur MCP Postgres de référence). Une limite de ce projet : la connexion de
// développement est superutilisateur, et un SET ROLE la ramènerait à ses droits ; en production, le text-to-SQL se
// connecte avec un rôle dédié, sans privilège
type Client = { query: (requete: string | { text: string; values?: unknown[]; queryMode?: "extended" }, valeurs?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; release: () => void };
export async function executerEnLecture(
  pool: { connect: () => Promise<Client> },
  sql: string,
  matricule: string,
  { lignesMax = 50, delaiMs = 3000 } = {},
): Promise<ResultatSql> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SELECT set_config('rhea.matricule', $1, true)", [matricule]); // true : pour cette transaction
    await client.query("SET LOCAL ROLE rhea_lecture");
    await client.query(`SET LOCAL statement_timeout = ${Math.trunc(delaiMs)}`);
    const { rows } = await client.query({ text: sql, queryMode: "extended" });
    const colonnes = rows.length > 0 ? Object.keys(rows[0]) : [];
    return { colonnes, lignes: rows.slice(0, lignesMax), tronque: rows.length > lignesMax };
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}
