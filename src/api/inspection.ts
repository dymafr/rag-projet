// Ce que l'interface d'inspection lit en plus des réponses (chapitre 14) : les salariés de démonstration, la configuration,
// l'index et une recherche seule, sans LLM qui rédige. Tout ce qui touche aux documents passe par basePour : la sécurité
// par ligne du chapitre 13 s'applique à l'interface comme à la recherche. Ces routes n'existent qu'en mode inspection :
// en production, elles en diraient trop (le prompt, les réglages, l'annuaire)
import type pg from "pg";
import { APPELS_PAR_OUTIL, TOKENS_MAX, TOURS_MAX } from "../agent/boucle.ts";
import { config } from "../config.ts";
import { nomDuModele } from "../embeddings/fournisseurs.ts";
import type { Tarifs } from "../eval/comparaison.ts";
import { MODELE_DU_SEUIL, SEUIL } from "../generation/abstention.ts";
import { BUDGET_PASSAGES, PASSAGES_DEMANDES } from "../generation/prompt.ts";
import { basePour, type Profil } from "../recherche/droits.ts";
import { trouverPassages } from "../recherche/passages.ts";
import { RECHERCHE } from "../recherche/reglages.ts";
import { destinations } from "../rgpd/localisation.ts";
import { lireIndexation } from "../stockage/schema.ts";
import { avecTrace, enBref, Trace, type EtapeTracee } from "../trace/trace.ts";

export type FicheSalarie = { matricule: string; prenom: string; nom: string; role: Profil; site: string; service: string; poste: string };
export type DocumentIndexe = {
  document: string;
  titre: string;
  type: string;
  acces: string;
  langue: string;
  sites: string[];
  date_effet: string;
  date_fin: string | null;
  passages: number;
  tokens: number;
};
export type PassageIndexe = { id: string; document: string; titres: string[]; texte: string; taille: number; type: string; acces: string; date_effet: string; date_fin: string | null };
export type Recherche = { passages: (ReturnType<typeof enBref> & { texte: string })[]; trace: EtapeTracee[] };

// Ce que rend GET /api/configuration. L'interface en recopie la forme (web/src/types.ts), chaque champ venu après la
// leçon 1 en facultatif : elle marche ainsi à chaque étape du chapitre
export type ConfigurationRhea = {
  generation: { fournisseur: string; modele: string };
  juge: { fournisseur: string; modele: string };
  embeddings: { fournisseur: string; modele: string; dimensions: number | null; nom: string };
  reclasseur: { fournisseur: string; modele: string; actif: boolean };
  recherche: typeof RECHERCHE;
  seuil: { valeur: number; mesureAvec: string; aJour: boolean };
  budget: { passagesDemandes: number; tokens: number };
  agent: { toursMax: number; tokensMax: number; appelsParOutil: number; recherche: string };
  prompt: string;
  index: { passages: number; modele: string | null; stockage: string | null };
  destinations: ReturnType<typeof destinations>;
  tarifs: Tarifs | null;
};

export type Inspection = {
  salaries: () => Promise<FicheSalarie[]>;
  configuration: () => Promise<ConfigurationRhea>;
  documents: (profil: Profil) => Promise<DocumentIndexe[]>;
  passagesDuDocument: (document: string, profil: Profil) => Promise<PassageIndexe[]>;
  passage: (id: string, profil: Profil) => Promise<PassageIndexe | null>;
  rechercher: (question: string, date: string, profil: Profil) => Promise<Recherche>;
};

// Les dates en AAAA-MM-JJ : le client pg rend un objet Date pour une colonne date, à minuit heure locale
const jour = (d: unknown) => (d instanceof Date ? d.toLocaleDateString("sv-SE") : d === null ? null : String(d));
const COLONNES = "id, document, titres, texte, taille, type, acces, date_effet, date_fin";
const enPassage = (r: Record<string, unknown>) => ({ ...r, date_effet: jour(r.date_effet), date_fin: jour(r.date_fin) }) as PassageIndexe;

export function inspectionDe(pool: pg.Pool, autres: { version: string; tarifs?: Tarifs }): Inspection {
  return {
    async salaries() {
      const { rows } = await pool.query<FicheSalarie>("SELECT matricule, prenom, nom, role, site, service, poste FROM salaries ORDER BY matricule");
      return rows;
    },

    async configuration(): Promise<ConfigurationRhea> {
      const indexation = await lireIndexation(pool);
      const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM chunks");
      return {
        generation: { fournisseur: config.LLM_PROVIDER, modele: config.LLM_MODEL },
        juge: { fournisseur: config.LLM_PROVIDER, modele: config.JUGE_MODEL || config.LLM_MODEL },
        embeddings: { fournisseur: config.EMBEDDING_PROVIDER, modele: config.EMBEDDING_MODEL, dimensions: indexation?.dimension ?? null, nom: nomDuModele() },
        reclasseur: { fournisseur: "transformers", modele: config.RERANK_MODEL, actif: RECHERCHE.reclassement },
        recherche: RECHERCHE,
        seuil: { valeur: SEUIL, mesureAvec: MODELE_DU_SEUIL, aJour: MODELE_DU_SEUIL === nomDuModele() },
        budget: { passagesDemandes: PASSAGES_DEMANDES, tokens: BUDGET_PASSAGES },
        agent: { toursMax: TOURS_MAX, tokensMax: TOKENS_MAX, appelsParOutil: APPELS_PAR_OUTIL, recherche: "secours" },
        prompt: autres.version,
        index: { passages: rows[0].n, modele: indexation?.modele ?? null, stockage: indexation?.stockage ?? null },
        destinations: destinations(config),
        tarifs: autres.tarifs ?? null,
      };
    },

    async documents(profil) {
      const { rows } = await basePour(pool, profil).query<DocumentIndexe>(
        `SELECT document, (array_agg(titres[1] ORDER BY id))[1] AS titre, min(type) AS type, min(acces) AS acces, min(langue) AS langue,
           coalesce((array_agg(sites ORDER BY id))[1], '{}') AS sites, min(date_effet) AS date_effet, max(date_fin) AS date_fin,
           count(*)::int AS passages, sum(taille)::int AS tokens
         FROM chunks GROUP BY document ORDER BY document`,
      );
      return rows.map((r) => ({ ...r, date_effet: jour(r.date_effet)!, date_fin: jour(r.date_fin) }));
    },

    async passagesDuDocument(document, profil) {
      // L'ordre des passages dans le document : DOC#1, DOC#2… (le numéro, et non l'ordre alphabétique : #10 après #9)
      const { rows } = await basePour(pool, profil).query(
        `SELECT ${COLONNES} FROM chunks WHERE document = $1 ORDER BY split_part(id, '#', 2)::int`,
        [document],
      );
      return rows.map(enPassage);
    },

    async passage(id, profil) {
      const { rows } = await basePour(pool, profil).query(`SELECT ${COLONNES} FROM chunks WHERE id = $1`, [id]);
      return rows[0] ? enPassage(rows[0]) : null;
    },

    // La recherche seule, comme la lance l'outil chercher_documents, avec sa trace : de quoi comprendre un classement
    // sans attendre le LLM qui rédige (les filtres extraits l'appellent quand même, si la question a un indice de date)
    async rechercher(question, date, profil) {
      const trace = new Trace();
      const resultats = await avecTrace(trace, () => trouverPassages(pool, question, PASSAGES_DEMANDES, profil, date));
      return { passages: resultats.map((p) => ({ ...enBref(p), texte: p.texte })), trace: trace.etapes };
    },
  };
}
