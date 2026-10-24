// Ce que l'interface d'inspection lit en plus des réponses (chapitre 14) : les salariés de démonstration, la configuration,
// l'index et une recherche seule, sans LLM qui rédige. Tout ce qui lit les documents de la base passe par basePour : la
// sécurité par ligne du chapitre 13 s'applique à l'interface comme à la recherche. Leçon 2 : les évaluations, elles,
// montrent ce que leurs exécutions ont gardé, passages réservés compris. Ces routes n'existent qu'en mode inspection :
// en production, elles en diraient trop (le prompt, les réglages, l'annuaire, les évaluations)
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type pg from "pg";
import { APPELS_PAR_OUTIL, TOKENS_MAX, TOURS_MAX } from "../agent/boucle.ts";
import { config } from "../config.ts";
import { nomDuModele } from "../embeddings/fournisseurs.ts";
import type { Tarifs } from "../eval/comparaison.ts";
import { desaccords, etiqueter, lireEtiquettes, type Desaccord, type Etiquette } from "../eval/etiquettes.ts";
import type { Execution, ResultatQuestion } from "../eval/production.ts";
import { empreinte } from "../eval/reponses.ts";
import { MODELE_DU_SEUIL, plancherMesure, plancherPour, SEUIL } from "../generation/abstention.ts";
import { BUDGET_PASSAGES, PASSAGES_DEMANDES } from "../generation/prompt.ts";
import { derive, parJour, type Jour } from "../observabilite/observations.ts";
import { basePour, type Profil } from "../recherche/droits.ts";
import { aujourdhui, LLM_DE_LA_RECHERCHE, RECHERCHE_DE_PRODUCTION, trouverPassages } from "../recherche/passages.ts";
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

// Une exécution d'évaluation sans ses résultats, et une question en bref : de quoi lister sans tout charger
export type ResumeExecution = Omit<Execution, "resultats">;
export type QuestionEnBref = {
  id: string;
  question: string;
  type: string;
  categorie: string;
  profil: Profil;
  matricule: string;
  reussie: boolean | null;
  criteres: { critere: string; ok: boolean | null }[];
  duree_ms: number;
  cout: number | null;
  outils: string[];
  citees: number;
  inventees: number;
  erreur: boolean;
};
// "cache" : une exécution du jeu caché, dont on ne lit que les scores (leçon 5) ; null : inconnue
export type DetailExecution = { resume: ResumeExecution; questions: QuestionEnBref[] };

// Ce que rend GET /api/configuration. L'interface en recopie la forme (web/src/types.ts), chaque champ venu après la
// leçon 1 en facultatif : elle marche ainsi à chaque étape du chapitre
export type ConfigurationRhea = {
  generation: { fournisseur: string; modele: string };
  juge: { fournisseur: string; modele: string };
  embeddings: { fournisseur: string; modele: string; dimensions: number | null; nom: string };
  reclasseur: { fournisseur: string; modele: string; actif: boolean };
  recherche: typeof RECHERCHE;
  seuil: { valeur: number; plancher: number | null; mesureAvec: string; aJour: boolean }; // plancher null : non mesuré pour ce modèle
  budget: { passagesDemandes: number; tokens: number };
  agent: { toursMax: number; tokensMax: number; appelsParOutil: number; recherche: string; verification: boolean };
  cache: { actif: boolean; seuil: number };
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
  evaluations: () => Promise<ResumeExecution[]>;
  evaluation: (nom: string) => Promise<DetailExecution | "cache" | null>;
  resultat: (nom: string, id: string) => Promise<ResultatQuestion | "cache" | null>;
  observations: () => Promise<{ jours: Jour[]; derive: ReturnType<typeof derive> }>; // leçon 7
  // Leçon 4 : les désaccords entre deux juges (les mêmes réponses), et la décision humaine sur l'un d'eux
  desaccords: (a: string, b: string) => Promise<{ desaccords: Desaccord[]; etiquettes: Etiquette[] } | null>;
  etiqueter: (a: string, id: string, reussie: boolean, raison: string) => Promise<boolean>;
};

export const RESULTATS = "eval/production/resultats";

// Les exécutions d'évaluation, lues sur le disque. Une exécution complète pèse plusieurs mégaoctets (toutes les traces) :
// on la garde en mémoire tant que son fichier ne change pas
export function lecteurDExecutions(dossier = RESULTATS) {
  const enMemoire = new Map<string, { modifie: number; execution: Execution }>();
  const lire = async (nom: string): Promise<Execution | null> => {
    if (!/^[\w-][\w.-]*$/.test(nom)) return null; // un nom de dossier simple : rien qui sorte de RESULTATS
    const fichier = join(dossier, nom, "execution.json");
    try {
      const { mtimeMs } = await stat(fichier);
      const garde = enMemoire.get(nom);
      if (garde?.modifie === mtimeMs) return garde.execution;
      const execution = JSON.parse(await readFile(fichier, "utf8")) as Execution;
      enMemoire.set(nom, { modifie: mtimeMs, execution });
      return execution;
    } catch (erreur) {
      if ((erreur as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw erreur;
    }
  };
  return {
    async resumes(): Promise<ResumeExecution[]> {
      let noms: string[];
      try {
        noms = await readdir(dossier);
      } catch {
        return []; // aucune évaluation encore
      }
      const resumes: ResumeExecution[] = [];
      for (const nom of noms) {
        try {
          resumes.push(JSON.parse(await readFile(join(dossier, nom, "resume.json"), "utf8")) as ResumeExecution);
        } catch {
          // un dossier sans résumé (une exécution qui vient de commencer) : ignoré
        }
      }
      return resumes.sort((a, b) => (a.date === b.date ? a.nom.localeCompare(b.nom) : b.date.localeCompare(a.date)));
    },
    lire,
  };
}

const enBrefQuestion = (r: ResultatQuestion): QuestionEnBref => ({
  id: r.question.id,
  question: r.question.question,
  type: r.question.type,
  categorie: r.question.categorie,
  profil: r.question.profil,
  matricule: r.question.matricule,
  reussie: r.verdict.reussie,
  criteres: r.verdict.criteres.map(({ critere, ok }) => ({ critere, ok })),
  duree_ms: r.obtenu.duree_ms,
  cout: r.obtenu.cout,
  outils: r.obtenu.outils,
  citees: r.obtenu.citees.length,
  inventees: r.obtenu.inventees.length,
  erreur: r.obtenu.erreur !== undefined,
});

// Les dates en AAAA-MM-JJ : le client pg rend un objet Date pour une colonne date, à minuit heure locale
const jour = (d: unknown) => (d instanceof Date ? d.toLocaleDateString("sv-SE") : d === null ? null : String(d));
const COLONNES = "id, document, titres, texte, taille, type, acces, date_effet, date_fin";
const enPassage = (r: Record<string, unknown>) => ({ ...r, date_effet: jour(r.date_effet), date_fin: jour(r.date_fin) }) as PassageIndexe;

export function inspectionDe(pool: pg.Pool, autres: { version: string; tarifs?: Tarifs; resultats?: string }): Inspection {
  const executions = lecteurDExecutions(autres.resultats);
  return {
    evaluations: () => executions.resumes(),

    async desaccords(a, b) {
      const [ea, eb] = [await executions.lire(a), await executions.lire(b)];
      if (!ea || !eb || ea.jeu === "cache" || eb.jeu === "cache") return null;
      return { desaccords: desaccords(ea, eb), etiquettes: await lireEtiquettes() };
    },

    // L'étiquette porte sur le texte de la réponse dans l'exécution a (la même dans b, par construction des désaccords)
    async etiqueter(a, id, reussie, raison) {
      const execution = await executions.lire(a);
      const r = execution?.jeu === "travail" ? execution.resultats.find((x) => x.question.id === id) : undefined;
      if (!r) return false;
      await etiqueter({ id, reponse: empreinte(r.obtenu.texte), reussie, raison, date: aujourdhui() });
      return true;
    },

    async observations() {
      const jours = await parJour(pool, 60);
      return { jours, derive: derive(jours, aujourdhui()) };
    },

    async evaluation(nom) {
      const execution = await executions.lire(nom);
      if (!execution) return null;
      if (execution.jeu === "cache") return "cache";
      const { resultats, ...resume } = execution;
      return { resume, questions: resultats.map(enBrefQuestion) };
    },

    async resultat(nom, id) {
      const execution = await executions.lire(nom);
      if (!execution) return null;
      if (execution.jeu === "cache") return "cache";
      return execution.resultats.find((r) => r.question.id === id) ?? null;
    },

    async salaries() {
      const { rows } = await pool.query<FicheSalarie>("SELECT matricule, prenom, nom, role, site, service, poste FROM salaries ORDER BY matricule");
      return rows;
    },

    async configuration(): Promise<ConfigurationRhea> {
      const indexation = await lireIndexation(pool);
      const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM chunks");
      return {
        generation: { fournisseur: config.LLM_PROVIDER, modele: config.LLM_MODEL },
        juge: { fournisseur: config.JUGE_PROVIDER ?? config.LLM_PROVIDER, modele: config.JUGE_MODEL || config.LLM_MODEL },
        embeddings: { fournisseur: config.EMBEDDING_PROVIDER, modele: config.EMBEDDING_MODEL, dimensions: indexation?.dimension ?? null, nom: nomDuModele() },
        reclasseur: {
          ...(config.RERANK_PROVIDER === "llm" ? { fournisseur: "llm", modele: LLM_DE_LA_RECHERCHE } : { fournisseur: config.RERANK_PROVIDER, modele: config.RERANK_MODEL }),
          actif: RECHERCHE_DE_PRODUCTION.reclassement,
        },
        recherche: RECHERCHE_DE_PRODUCTION,
        seuil: { valeur: SEUIL, plancher: plancherMesure(nomDuModele()) ? plancherPour(nomDuModele()) : null, mesureAvec: MODELE_DU_SEUIL, aJour: MODELE_DU_SEUIL === nomDuModele() },
        budget: { passagesDemandes: PASSAGES_DEMANDES, tokens: BUDGET_PASSAGES },
        agent: { toursMax: TOURS_MAX, tokensMax: TOKENS_MAX, appelsParOutil: APPELS_PAR_OUTIL, recherche: "secours", verification: config.VERIFICATION },
        cache: { actif: config.CACHE_SEMANTIQUE, seuil: config.CACHE_SEUIL },
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
