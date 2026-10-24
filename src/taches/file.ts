// La file d'attente des tâches lentes (chapitre 14, leçon 1) : réindexer le corpus, effacer un document. Le serveur ne les
// fait pas lui-même : une réindexation prend des minutes et du processeur, pendant lesquels il doit continuer à répondre.
// On les inscrit dans une table ; un autre processus, le travailleur (npm run travailleur), les prend une à une.
// Une table PostgreSQL suffit à une file : la base est déjà là, sauvegardée, transactionnelle. Deux travailleurs ne
// prennent jamais la même tâche grâce à FOR UPDATE SKIP LOCKED : chacun verrouille la ligne qu'il prend, et saute celles
// qu'un autre a déjà verrouillées, sans l'attendre. Des bibliothèques font la même chose avec plus d'options (pg-boss,
// Graphile Worker) ; le principe est celui-ci
import type { Base } from "../stockage/base.ts";

export const TYPES_DE_TACHE = ["reindexer", "effacer"] as const;
export type TypeDeTache = (typeof TYPES_DE_TACHE)[number];
export type Etat = "en_attente" | "en_cours" | "faite" | "echouee";

export type Tache = {
  id: number;
  type: TypeDeTache;
  donnees: Record<string, unknown>;
  etat: Etat;
  essais: number;
  max_essais: number;
  disponible_le: Date; // pas avant : un nouvel essai attend un peu (backoff)
  cree_le: Date;
  commence_le: Date | null;
  termine_le: Date | null;
  erreur: string | null;
};

export const SCHEMA_TACHES = `
CREATE TABLE IF NOT EXISTS taches (
  id bigserial PRIMARY KEY,
  type text NOT NULL,
  donnees jsonb NOT NULL DEFAULT '{}',
  etat text NOT NULL DEFAULT 'en_attente' CHECK (etat IN ('en_attente', 'en_cours', 'faite', 'echouee')),
  essais integer NOT NULL DEFAULT 0,
  max_essais integer NOT NULL DEFAULT 3,
  disponible_le timestamptz NOT NULL DEFAULT now(),
  cree_le timestamptz NOT NULL DEFAULT now(),
  commence_le timestamptz,
  termine_le timestamptz,
  erreur text
)`;
// Les tâches à prendre, dans l'ordre : un index partiel, qui ne contient que les tâches en attente
export const INDEX_TACHES = "CREATE INDEX IF NOT EXISTS taches_a_faire ON taches (disponible_le, id) WHERE etat = 'en_attente'";

// Une instruction par requête : une requête avec paramètres (ou PGlite) n'en accepte qu'une
export async function creerFile(base: Base) {
  await base.query(SCHEMA_TACHES);
  await base.query(INDEX_TACHES);
}

// Ajouter une tâche. NOTIFY réveille tout de suite un travailleur qui écoute (LISTEN taches) ; sans lui, il la verra à
// son prochain passage
export async function ajouter(base: Base, type: TypeDeTache, donnees: Record<string, unknown> = {}, maxEssais = 3): Promise<number> {
  const { rows } = await base.query<{ id: string }>("INSERT INTO taches (type, donnees, max_essais) VALUES ($1, $2, $3) RETURNING id", [type, JSON.stringify(donnees), maxEssais]);
  await base.query("NOTIFY taches");
  return Number(rows[0].id);
}

// Prendre la plus ancienne tâche disponible, en une seule requête : la sélection et le passage à en_cours se font dans la
// même transaction implicite, sous verrou. null : rien à faire
export async function prendre(base: Base): Promise<Tache | null> {
  const { rows } = await base.query<Tache>(
    `UPDATE taches SET etat = 'en_cours', essais = essais + 1, commence_le = now(), erreur = NULL
     WHERE id = (
       SELECT id FROM taches WHERE etat = 'en_attente' AND disponible_le <= now()
       ORDER BY disponible_le, id
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING *`,
  );
  return rows[0] ? { ...rows[0], id: Number(rows[0].id) } : null;
}

export async function terminer(base: Base, id: number) {
  await base.query("UPDATE taches SET etat = 'faite', termine_le = now() WHERE id = $1", [id]);
}

// L'attente avant un nouvel essai : 30 s, puis 1 min, 2 min… (un backoff exponentiel), au plus une heure. Une panne
// passagère (la base redémarre, le réseau coupe) a le temps de passer ; une tâche impossible ne tourne pas en boucle
export const attenteAvantEssai = (essais: number) => Math.min(30 * 2 ** (essais - 1), 3600);

// Une tâche en échec : un nouvel essai plus tard s'il en reste, sinon échouée pour de bon, avec son erreur
export async function echouer(base: Base, tache: Pick<Tache, "id" | "essais" | "max_essais">, erreur: string) {
  if (tache.essais < tache.max_essais) {
    await base.query("UPDATE taches SET etat = 'en_attente', disponible_le = now() + make_interval(secs => $2), erreur = $3 WHERE id = $1", [
      tache.id,
      attenteAvantEssai(tache.essais),
      erreur,
    ]);
  } else {
    await base.query("UPDATE taches SET etat = 'echouee', termine_le = now(), erreur = $2 WHERE id = $1", [tache.id, erreur]);
  }
}

// Un travailleur arrêté en pleine tâche (redémarrage, plantage) la laisse en_cours pour toujours : au-delà d'un délai,
// elle revient en attente s'il lui reste un essai (prendre en comptera un de plus), sinon elle échoue pour de bon : une
// tâche qui fait tomber le travailleur à chaque essai ne revient pas sans fin
export async function recuperer(base: Base, minutes = 30): Promise<number> {
  const { rows } = await base.query(
    `UPDATE taches SET
       etat = CASE WHEN essais < max_essais THEN 'en_attente' ELSE 'echouee' END,
       termine_le = CASE WHEN essais < max_essais THEN NULL ELSE now() END,
       erreur = CASE WHEN essais < max_essais THEN erreur ELSE 'abandonnée en cours, à chaque essai' END
     WHERE etat = 'en_cours' AND commence_le < now() - make_interval(mins => $1) RETURNING id`,
    [minutes],
  );
  return rows.length;
}

// L'état de la file : le nombre de tâches par état, et les dernières
export async function etatDeLaFile(base: Base, dernieres = 20) {
  const { rows: comptes } = await base.query<{ etat: Etat; n: number }>("SELECT etat, count(*)::int AS n FROM taches GROUP BY etat");
  const { rows } = await base.query<Tache>("SELECT * FROM taches ORDER BY id DESC LIMIT $1", [dernieres]);
  return { comptes: Object.fromEntries(comptes.map((c) => [c.etat, c.n])) as Partial<Record<Etat, number>>, dernieres: rows.map((r) => ({ ...r, id: Number(r.id) })) };
}
