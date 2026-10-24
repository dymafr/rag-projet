// Ce que fait Rhéa pour une question posée au serveur (chapitre 14) : l'agent complet, et non plus le pipeline du
// chapitre 7. Les événements partent au fil de l'eau : chaque étape de la trace dès qu'elle commence et finit (en mode
// inspection), une demande de confirmation avant une action, puis la réponse, ses sources et ce qu'elle a coûté
import { agir, type Agent } from "../agent/boucle.ts";
import { sourcesCitees } from "../agent/sources.ts";
import { personnelle, type Cle, type EnCache } from "../cache/semantique.ts";
import { duFournisseur } from "../charge/disjoncteur.ts";
import { cout, type Tarifs } from "../eval/comparaison.ts";
import { horsCorpus } from "../generation/abstention.ts";
import type { Usage } from "../llm.ts";
import type { Observation } from "../observabilite/observations.ts";
import type { Echange } from "../recherche/conversation.ts";
import type { Profil } from "../recherche/droits.ts";
import { aDesIndices } from "../recherche/filtres-extraits.ts";
import type { Resultat } from "../recherche/vectorielle.ts";
import { avecTrace, enBref, etape, nombre, noter, pluriel, Trace, type EvenementTrace, type Modele } from "../trace/trace.ts";
import { Canal } from "./canal.ts";
import type { Confirmations } from "./confirmations.ts";

// Le salarié connecté : son matricule et son profil, lu dans l'annuaire
export type Session = { matricule: string; profil: Profil };

export type SourceCitee = ReturnType<typeof enBref> & { texte: string };
// degrade (leçon 8) : aucun LLM n'a pu répondre, Rhéa a rendu les passages les plus proches à la place d'une réponse
// observation (leçon 7) : l'identifiant de la question dans l'observabilité, pour que le salarié donne son avis
// cache (leçon 6) : la réponse vient du cache sémantique, avec la similarité de la question qui l'avait reçue
export type Fin = { usage: Usage; cout: { min: number; max: number } | null; duree_ms: number; modele: Modele; prompt: string; tours: number; degrade?: boolean; observation?: string; cache?: number };

export type EvenementAgent =
  | { nom: "etape"; donnees: EvenementTrace }
  | { nom: "confirmation"; donnees: { id: string; action: string } }
  | { nom: "texte"; donnees: { texte: string } }
  | { nom: "sources"; donnees: { citees: SourceCitee[]; inventees: string[] } }
  | { nom: "fin"; donnees: Fin };

export type DependancesAgent = {
  // Rhéa pour cette session ; confirmer : la demande d'accord avant une action, que le serveur fait passer au navigateur
  agent: (session: Session, confirmer: Agent["confirmer"]) => Agent;
  confirmations: Confirmations;
  date: () => string; // la date du jour, AAAA-MM-JJ
  version: string; // celle du prompt système : v6 1a2b3c4d
  tarifs?: Tarifs; // pour le coût d'une réponse ; absent ou sans le modèle : coût inconnu (un modèle local ne coûte rien)
  inspection: boolean; // la trace part-elle au navigateur ?
  // Leçon 8 : la recherche seule, sans aucun LLM, pour dégrader proprement quand aucun ne répond ; et le plancher du
  // modèle d'embedding (leçon 4), sous lequel aucun passage n'est montré (absent : le seuil d'abstention du chapitre 7)
  passagesSeuls?: (question: string, session: Session, date: string) => Promise<Resultat[]>;
  plancher?: number;
  // Leçon 7 : garder une observation de chaque question (sans son texte : observations.ts), et rendre son identifiant
  observer?: (session: Session, observation: Omit<Observation, "pseudonyme" | "profil">) => Promise<string>;
  // Leçon 6 : le cache sémantique (cache/semantique.ts) ; lire rend aussi le vecteur de la question, réutilisé pour écrire
  cache?: {
    seuil: number;
    version: () => string; // celle du prompt, des LLM, des réglages et de l'index : la réponse en dépend
    lire: (question: string, cle: Cle) => Promise<{ trouve: EnCache | null; vecteur: number[] }>;
    ecrire: (vecteur: number[], cle: Cle, reponse: string, sources: SourceCitee[]) => Promise<void>;
  };
};

// Les messages du mode dégradé (leçon 8) : dire ce qui se passe, et ce que le salarié peut faire
export const DEGRADE_AVEC_PASSAGES =
  "Je ne peux pas rédiger de réponse pour le moment : le service qui les rédige ne répond pas. Voici les passages de la " +
  "documentation les plus proches de votre question ; vérifiez qu'ils correspondent bien à votre cas.";
export const DEGRADE_SANS_PASSAGE =
  "Je ne peux pas répondre pour le moment : le service qui rédige les réponses ne répond pas. Réessayez dans quelques " +
  "minutes, ou ouvrez un ticket dans l'espace RH.";
export const PASSAGES_DEGRADES = 3;

export async function* repondreEnAgent(
  question: string,
  session: Session,
  dependances: DependancesAgent,
  signal?: AbortSignal,
  historique: Echange[] = [],
): AsyncGenerator<EvenementAgent> {
  const canal = new Canal<EvenementAgent>();
  // Sans inspection (en production), rien de la trace ne part au navigateur : ni les passages lus, ni le prompt
  const trace = new Trace(dependances.inspection ? (evenement) => canal.pousser({ nom: "etape", donnees: evenement }) : undefined);
  const confirmer: Agent["confirmer"] = (_appel, action) => {
    const { id, reponse } = dependances.confirmations.demander(session.matricule, signal);
    canal.pousser({ nom: "confirmation", donnees: { id, action } });
    return reponse;
  };
  const agent = dependances.agent(session, confirmer);
  const modele = agent.modele ?? { fournisseur: "inconnu", modele: "inconnu" };
  const debut = performance.now();
  const outilsAppeles: string[] = [];
  // Un nom d'outil que le LLM invente (« dossier_de_K0042 ») peut porter n'importe quoi : il entre comme « inconnu »
  const declares = new Set(agent.outils.map((o) => o.nom));
  // Leçon 7 : l'observation de la question, enregistrée avant la fin pour que son identifiant parte avec elle. Une panne
  // de l'observabilité ne doit jamais coûter sa réponse au salarié : elle se note dans le terminal, sans plus
  const observer = async (o: Omit<Observation, "pseudonyme" | "profil" | "question" | "etapes" | "outils">) => {
    if (!dependances.observer) return undefined;
    try {
      return await dependances.observer(session, { ...o, question, etapes: trace.etapes, outils: outilsAppeles });
    } catch (erreur) {
      console.error("Observation non enregistrée :", erreur instanceof Error ? erreur.message : erreur);
      return undefined;
    }
  };
  const duree = () => Math.round(performance.now() - debut);
  let pourLeCache: { vecteur: number[]; cle: Cle } | undefined; // leçon 6 : de quoi écrire la réponse dans le cache

  const travail = avecTrace(trace, async () => {
    const contexte = { date: dependances.date(), matricule: session.matricule, profil: session.profil };
    try {
      if (await depuisLeCache(contexte.date)) return;
      await suivreAgent(contexte);
    } catch (erreur) {
      if (!duFournisseur(erreur) || !dependances.passagesSeuls || signal?.aborted) {
        const nul = { entree: 0, enCache: 0, sortie: 0 };
        if (!signal?.aborted) await observer({ statut: "erreur", duree_ms: duree(), tours: 0, usage: nul, cout: null, modele: `${modele.fournisseur} ${modele.modele}`, citees: [] });
        throw erreur;
      }
      // Leçon 8 : aucun LLM ne répond (panne, surcharge, disjoncteurs ouverts). Plutôt qu'une erreur, les passages les
      // plus proches, trouvés sans LLM. Une autre erreur (un bogue) repart telle quelle, ci-dessus. Sous le plancher,
      // rien ne vaut la peine d'être montré
      let passages: Resultat[];
      try {
        passages = await dependances.passagesSeuls(question, session, contexte.date);
      } catch (seconde) {
        // La recherche seule échoue aussi (la base, les embeddings) : la question est observée en erreur, comme ci-dessus
        const nul = { entree: 0, enCache: 0, sortie: 0 };
        if (!signal?.aborted) await observer({ statut: "erreur", duree_ms: duree(), tours: 0, usage: nul, cout: null, modele: `${modele.fournisseur} ${modele.modele}`, citees: [] });
        throw seconde;
      }
      const proches = horsCorpus(passages, dependances.plancher) ? [] : passages.slice(0, PASSAGES_DEGRADES);
      noter("degradation", "Réponse dégradée", {
        resume: `aucun LLM disponible : ${pluriel(proches.length, "passage rendu", "passages rendus")} sans réponse rédigée`,
        details: { erreur: erreur instanceof Error ? erreur.message.slice(0, 300) : String(erreur), passages: proches.map(enBref) },
      });
      canal.pousser({ nom: "texte", donnees: { texte: proches.length > 0 ? DEGRADE_AVEC_PASSAGES : DEGRADE_SANS_PASSAGE } });
      canal.pousser({ nom: "sources", donnees: { citees: proches.map((p) => ({ ...enBref(p), texte: p.texte })), inventees: [] } });
      const nul = { entree: 0, enCache: 0, sortie: 0 };
      const id = await observer({ statut: "degradee", duree_ms: duree(), tours: 0, usage: nul, cout: null, modele: `${modele.fournisseur} ${modele.modele}`, citees: proches.map((p) => p.id) });
      canal.pousser({
        nom: "fin",
        donnees: { usage: nul, cout: null, duree_ms: duree(), modele, prompt: dependances.version, tours: 0, degrade: true, ...(id && { observation: id }) },
      });
    }
  });
  travail.then(
    () => canal.fermer(),
    (erreur: unknown) => canal.fermer(erreur),
  );
  yield* canal;

  // Leçon 6 : une question sans historique se cherche d'abord dans le cache. Trouvée : la réponse gardée, ses sources,
  // aucun LLM. Sinon, le vecteur de la question est gardé (pourLeCache) pour y écrire la réponse, si elle n'est pas personnelle
  async function depuisLeCache(date: string): Promise<boolean> {
    const cache = dependances.cache;
    // Une question qui cite une date ou un type de document (« en 2025 », « dans la FAQ ») n'y passe pas : sa réponse
    // dépend de ce qu'elle cite, que la clé du cache ne contient pas
    if (!cache || historique.length > 0 || aDesIndices(question)) return false;
    const cle: Cle = { profil: session.profil, jour: date, version: cache.version() };
    const { trouve, vecteur } = await etape("cache", "Cache sémantique", () => cache.lire(question, cle), ({ trouve }) => ({
      resume: trouve ? `réponse reprise (similarité ${nombre(trouve.similarite)}, seuil ${nombre(cache.seuil, 2)})` : `aucune réponse assez proche (seuil ${nombre(cache.seuil, 2)})`,
      details: { seuil: cache.seuil, ...(trouve && { similarite: trouve.similarite, sources: trouve.sources.map((s) => s.id) }) },
    }));
    pourLeCache = { vecteur, cle };
    if (!trouve) return false;
    canal.pousser({ nom: "texte", donnees: { texte: trouve.reponse } });
    canal.pousser({ nom: "sources", donnees: { citees: trouve.sources, inventees: [] } });
    const nul = { entree: 0, enCache: 0, sortie: 0 };
    const id = await observer({ statut: "citee", duree_ms: duree(), tours: 0, usage: nul, cout: 0, modele: "cache", citees: trouve.sources.map((s) => s.id) });
    canal.pousser({
      nom: "fin",
      donnees: { usage: nul, cout: { min: 0, max: 0 }, duree_ms: duree(), modele: { fournisseur: "cache", modele: "sémantique" }, prompt: dependances.version, tours: 0, cache: trouve.similarite, ...(id && { observation: id }) },
    });
    return true;
  }

  async function suivreAgent(contexte: { date: string; matricule: string; profil: Profil }) {
    const vus: Resultat[] = []; // tous les passages rendus par les outils : seules leurs sources peuvent être citées
    const appels: { id: string; nom: string }[] = [];
    let ficheDOffice = ""; // la fiche lue d'office : y reprendre un nom, le poste, le service ou le site rend la réponse personnelle
    for await (const e of agir(question, agent, contexte, historique)) {
      if (signal?.aborted) return; // le salarié est parti : inutile d'aller plus loin
      if (e.type === "appel") (outilsAppeles.push(declares.has(e.appel.nom) ? e.appel.nom : "inconnu"), appels.push(e.appel));
      if (e.type === "resultat" && e.appel.id === "organigramme-d-office") ficheDOffice = e.resultat.texte;
      if (e.type === "resultat") vus.push(...(e.resultat.passages ?? []));
      if (e.type !== "reponse") continue;
      // Une source citée doit venir d'un passage qu'un outil a rendu : sinon, le LLM l'a inventée (chapitre 10)
      const { citees, inventees } = sourcesCitees(e.texte, vus);
      noter("citations", "Sources citées", {
        resume: `${pluriel(citees.length, "source citée", "sources citées")}${inventees.length > 0 ? `, ${pluriel(inventees.length, "introuvable")}` : ""}`,
        details: { citees: citees.map(enBref), inventees },
      });
      const sources = citees.map((p) => ({ ...enBref(p), texte: p.texte }));
      canal.pousser({ nom: "texte", donnees: { texte: e.texte } });
      canal.pousser({ nom: "sources", donnees: { citees: sources, inventees } });
      // Leçon 6 : une réponse citée, générique (ni outil personnel, ni rien de la fiche du salarié), va dans le cache sémantique
      if (pourLeCache && dependances.cache && citees.length > 0 && inventees.length === 0 && !personnelle({ historique: historique.length, appels, ficheDOffice, texte: e.texte })) {
        await dependances.cache.ecrire(pourLeCache.vecteur, pourLeCache.cle, e.texte, sources);
        noter("cache-ecrit", "Réponse gardée dans le cache", { resume: "réponse générique et citée : gardée pour les questions très proches du jour" });
      }
      // Le modèle qui a vraiment répondu : celui de repli, s'il a pris le relais (leçon 8)
      const actuel = agent.modele ?? modele;
      const prix = dependances.tarifs ? cout(e.usage, 0, `${actuel.fournisseur} ${actuel.modele}`, dependances.tarifs) : null;
      const id = await observer({
        statut: citees.length > 0 ? "citee" : "sans-source",
        duree_ms: duree(),
        tours: e.tour,
        usage: e.usage,
        cout: prix ? prix.max : null,
        modele: `${actuel.fournisseur} ${actuel.modele}`,
        citees: citees.map((p) => p.id),
      });
      canal.pousser({
        nom: "fin",
        donnees: { usage: e.usage, cout: prix, duree_ms: duree(), modele: actuel, prompt: dependances.version, tours: e.tour, ...(id && { observation: id }) },
      });
    }
  }
}
