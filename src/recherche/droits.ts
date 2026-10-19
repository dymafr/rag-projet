// Qui peut lire quoi (chapitre 13, leçon 1). Chaque document porte un niveau d'accès, sa métadonnée acces (chapitre 4) :
// tous, manager ou rh. Chaque salarié a un profil, sa colonne role dans l'annuaire (chapitre 10) : salarie, manager ou
// rh. Le profil donne les niveaux qu'il peut lire. Le tri se fait avant le LLM : un passage réservé n'entre jamais dans
// le prompt, car aucune consigne ne garantit qu'un LLM taira ce qu'il a lu. Deux barrières : le filtre de la recherche
// (vectorielle.ts), et la sécurité par ligne de PostgreSQL sur la table chunks, qui tient même si le filtre manque
import type { Base } from "../stockage/base.ts";

export const PROFILS = ["salarie", "manager", "rh"] as const;
export type Profil = (typeof PROFILS)[number];

// Un salarié lit les documents ouverts à tous ; un manager, aussi ceux des managers ; le service RH, aussi les tickets
export const NIVEAUX: Record<Profil, string[]> = {
  salarie: ["tous"],
  manager: ["tous", "manager"],
  rh: ["tous", "manager", "rh"],
};

// Le profil d'un salarié, lu dans l'annuaire : jamais une valeur que le client ou le LLM pourrait choisir. null : aucun
// salarié n'a ce matricule
export async function profilDuSalarie(base: Base, matricule: string): Promise<Profil | null> {
  const { rows } = await base.query<{ role: Profil }>("SELECT role FROM salaries WHERE matricule = $1", [matricule]);
  return rows[0]?.role ?? null;
}

// Le profil d'une session en ligne de commande : celui du salarié de --matricule, ou, sans matricule, le plus restreint
// (les documents ouverts à tous). Un matricule inconnu arrête tout : mieux vaut refuser que deviner
export async function profilDeSession(base: Base, matricule: string | undefined): Promise<Profil> {
  if (matricule === undefined) return "salarie";
  const profil = await profilDuSalarie(base, matricule);
  if (!profil) throw new Error(`Aucun salarié n'a le matricule ${matricule} : recherche refusée`);
  return profil;
}

// La seconde barrière, dans la base. Idempotent : npm run indexer le relance à chaque fois, car une reconstruction
// remplace la table chunks, et ses politiques avec elle. Le rôle rhea_recherche ne voit que les lignes dont le niveau
// figure dans rhea.niveaux, posé par notre code pour une transaction. Sans ce réglage, la liste est vide : il ne voit
// rien. Ni le propriétaire de la table ni un superutilisateur ne sont concernés : ils passent outre (d'où SET ROLE)
export const SCHEMA_DROITS = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rhea_recherche') THEN CREATE ROLE rhea_recherche NOLOGIN; END IF;
END $$;
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lecture_par_niveau ON chunks;
CREATE POLICY lecture_par_niveau ON chunks FOR SELECT TO rhea_recherche
  USING (acces = ANY (string_to_array(current_setting('rhea.niveaux', true), ',')));
GRANT SELECT ON chunks TO rhea_recherche;
`;

export const protegerChunks = (base: Base) => base.query(SCHEMA_DROITS);

// Ce qu'il faut pour isoler une requête : une connexion à soi le temps d'une transaction. Le pool de src/db.ts a cette forme
type Client = Base & { release: () => void };
export type Connexions = Base & { connect: () => Promise<Client> };

// Une base qui ne montre que ce qu'un profil peut lire. Chaque requête passe dans sa transaction, en lecture seule, avec
// les niveaux du profil, sous le rôle rhea_recherche. pool.connect : ces instructions doivent passer par la même
// connexion. ROLLBACK à la fin : rien ne reste sur la connexion rendue au pool. Une transaction par requête, et non une
// pour toute la recherche : la connexion n'est pas retenue pendant que le LLM réfléchit (filtres, reformulations)
export function basePour(pool: Connexions, profil: Profil): Base {
  const niveaux = NIVEAUX[profil];
  if (!niveaux?.length) throw new Error(`Profil inconnu : ${profil}`);
  return {
    async query<Ligne extends object = Record<string, unknown>>(sql: string, parametres?: unknown[]) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN READ ONLY");
        await client.query("SELECT set_config('rhea.niveaux', $1, true)", [niveaux.join(",")]); // true : pour cette transaction
        await client.query("SET LOCAL ROLE rhea_recherche");
        return await client.query<Ligne>(sql, parametres);
      } finally {
        await client.query("ROLLBACK").catch(() => {});
        client.release();
      }
    },
  };
}
