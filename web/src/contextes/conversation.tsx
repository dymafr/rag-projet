// La conversation avec Rhéa : chaque question part à POST /ask avec les trois derniers échanges, et sa réponse arrive en
// flux (Server-Sent Events) : les étapes au fil de l'eau, une demande de confirmation avant une action, puis le texte,
// les sources et ce que la réponse a coûté. La conversation vit au-dessus des vues : on peut aller voir l'index pendant
// que Rhéa répond. Changer de salarié commence une nouvelle conversation : son historique ne doit pas partir au nom d'un
// autre profil
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { appeler, enTetes, ErreurApi, estAbandon, messageDErreur, SERVEUR_INJOIGNABLE } from "../api/client.ts";
import { lireEvenements } from "../api/flux.ts";
import { estObjet } from "../outils/lecture.ts";
import type { EtapeTracee, EtapeVue, EvenementTrace, Fin, SourceCitee } from "../types.ts";
import { useSession } from "./session.tsx";

export const TOURS_D_HISTORIQUE = 3; // TOURS côté serveur (serveur : recherche/conversation.ts)
const REPONSE_MAX = 4000; // la longueur maximale d'une réponse dans l'historique (serveur : api/serveur.ts)

export type Confirmation = {
  id: string;
  action: string;
  recue: number; // Date.now() : le serveur refuse de lui-même après deux minutes
  etat: "attente" | "envoi" | "accordee" | "refusee" | "erreur";
  erreur?: string;
};

export type Echange = {
  id: string;
  question: string;
  matricule: string;
  etat: "en-cours" | "terminee" | "arretee" | "erreur";
  debutLocal: number; // performance.now() au départ
  historique: number; // les échanges précédents envoyés avec la question
  etapes: EtapeVue[];
  confirmations: Confirmation[];
  texte?: string;
  sources?: { citees: SourceCitee[]; inventees: string[] };
  fin?: Fin;
  erreur?: string;
  reessayerApres?: number; // Date.now() : le serveur a dit « trop de questions », avec le délai Retry-After
  avis?: Avis;
};

// L'avis du salarié sur une réponse (leçon 7) : pouce levé ou baissé, un commentaire facultatif
export type Avis = { note: 1 | -1; commentaire: string; etat: "envoi" | "ok" | "erreur"; erreur?: string; absent?: boolean };

type Etat = { echanges: Echange[]; selection: string | null; notice: string | null };

type Action =
  | { type: "demarrer"; echange: Echange }
  | { type: "evenement"; id: string; nom: string; donnees: unknown }
  | { type: "clore"; id: string; etat: Exclude<Echange["etat"], "en-cours">; erreur?: string; reessayerApres?: number }
  | { type: "avis"; id: string; avis: Avis }
  | { type: "confirmation"; id: string; confirmation: string; etat: Confirmation["etat"]; erreur?: string }
  | { type: "selectionner"; id: string }
  | { type: "vider"; notice: string | null }
  | { type: "effacer-notice" };

function appliquerEtape(etapes: EtapeVue[], evenement: EvenementTrace): EtapeVue[] {
  if (evenement.type === "debut") {
    if (etapes.some((e) => e.id === evenement.etape.id)) return etapes;
    return [...etapes, { ...evenement.etape, statut: "en-cours" }];
  }
  const fin: EtapeTracee = evenement.etape;
  const i = etapes.findIndex((e) => e.id === fin.id);
  if (i < 0) return [...etapes, fin];
  const copie = etapes.slice();
  copie[i] = fin;
  return copie;
}

function lireEvenement(echange: Echange, nom: string, donnees: unknown): Echange {
  if (!estObjet(donnees)) return echange;
  switch (nom) {
    case "etape":
      return { ...echange, etapes: appliquerEtape(echange.etapes, donnees as EvenementTrace) };
    case "confirmation":
      if (typeof donnees.id !== "string" || typeof donnees.action !== "string") return echange;
      return { ...echange, confirmations: [...echange.confirmations, { id: donnees.id, action: donnees.action, recue: Date.now(), etat: "attente" }] };
    case "texte":
      return typeof donnees.texte === "string" ? { ...echange, texte: donnees.texte } : echange;
    case "sources":
      return { ...echange, sources: donnees as Echange["sources"] };
    case "fin":
      return { ...echange, fin: donnees as Fin };
    case "erreur":
      return { ...echange, etat: "erreur", erreur: typeof donnees.message === "string" ? donnees.message : "Rhéa n'a pas pu terminer sa réponse." };
    default:
      return echange;
  }
}

function reducteur(etat: Etat, action: Action): Etat {
  const changer = (id: string, f: (e: Echange) => Echange): Etat => ({ ...etat, echanges: etat.echanges.map((e) => (e.id === id ? f(e) : e)) });
  switch (action.type) {
    case "demarrer":
      return { ...etat, echanges: [...etat.echanges, action.echange], selection: action.echange.id, notice: null };
    case "evenement":
      return changer(action.id, (e) => lireEvenement(e, action.nom, action.donnees));
    case "clore":
      return changer(action.id, (e) => ({
        ...e,
        etat: e.etat === "erreur" ? "erreur" : action.etat,
        erreur: e.erreur ?? action.erreur,
        reessayerApres: action.reessayerApres,
        // Une étape commencée et jamais finie : la réponse s'est arrêtée avant
        etapes: e.etapes.map((s) => (s.statut === "en-cours" ? { ...s, statut: "interrompue" } : s)),
        // Une demande de confirmation restée sans réponse : le serveur l'a refusée
        confirmations: e.confirmations.map((c) => (c.etat === "attente" || c.etat === "envoi" ? { ...c, etat: "refusee" } : c)),
      }));
    case "confirmation":
      return changer(action.id, (e) => ({
        ...e,
        confirmations: e.confirmations.map((c) => (c.id === action.confirmation ? { ...c, etat: action.etat, erreur: action.erreur } : c)),
      }));
    case "avis":
      return changer(action.id, (e) => ({ ...e, avis: action.avis }));
    case "selectionner":
      return { ...etat, selection: action.id };
    case "vider":
      return { echanges: [], selection: null, notice: action.notice };
    case "effacer-notice":
      return { ...etat, notice: null };
  }
}

type Valeur = Etat & {
  enCours: boolean;
  envoyer: (question: string) => void;
  arreter: () => void;
  nouvelle: () => void;
  choisir: (id: string) => void;
  repondre: (echange: string, confirmation: string, accord: boolean) => void;
  donnerAvis: (echange: string, note: 1 | -1, commentaire: string) => void;
  effacerNotice: () => void;
  historiqueEnvoye: number; // combien d'échanges partiraient avec la prochaine question
};

const Contexte = createContext<Valeur | null>(null);

// Les échanges que lit la condensation : les derniers terminés, avec leur réponse
function historiqueDe(echanges: Echange[]) {
  return echanges
    .filter((e) => e.etat === "terminee" && e.texte)
    .slice(-TOURS_D_HISTORIQUE)
    .map((e) => ({ question: e.question, reponse: (e.texte ?? "").slice(0, REPONSE_MAX) }));
}

export function FournisseurConversation({ children }: { children: ReactNode }) {
  const { matricule } = useSession();
  const [etat, dispatch] = useReducer(reducteur, { echanges: [], selection: null, notice: null });
  const annulation = useRef<AbortController | null>(null);
  const echanges = useRef(etat.echanges);
  echanges.current = etat.echanges;
  const enCours = etat.echanges.some((e) => e.etat === "en-cours");

  const envoyer = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || annulation.current) return;
      const historique = historiqueDe(echanges.current);
      const id = crypto.randomUUID();
      const controleur = new AbortController();
      annulation.current = controleur;
      dispatch({
        type: "demarrer",
        echange: { id, question: q, matricule, etat: "en-cours", debutLocal: performance.now(), historique: historique.length, etapes: [], confirmations: [] },
      });
      try {
        const reponse = await fetch("/ask", {
          method: "POST",
          headers: { ...enTetes({ matricule, json: true }), Accept: "text/event-stream" },
          body: JSON.stringify({ question: q, historique }),
          signal: controleur.signal,
        });
        if (!reponse.ok || !reponse.body) {
          // 503 : trop de questions à la fois (leçon 8) ; Retry-After dit dans combien de secondes réessayer
          const delai = reponse.status === 503 ? Number(reponse.headers.get("Retry-After")) : NaN;
          dispatch({ type: "clore", id, etat: "erreur", erreur: await messageDErreur(reponse), reessayerApres: Number.isFinite(delai) && delai > 0 ? Date.now() + delai * 1000 : undefined });
          return;
        }
        let fin = false;
        for await (const { nom, donnees } of lireEvenements(reponse.body)) {
          dispatch({ type: "evenement", id, nom, donnees });
          if (nom === "fin") fin = true;
        }
        dispatch({ type: "clore", id, etat: fin ? "terminee" : "erreur", erreur: fin ? undefined : "La réponse s'est interrompue avant la fin." });
      } catch (erreur) {
        if (estAbandon(erreur)) dispatch({ type: "clore", id, etat: "arretee" });
        else dispatch({ type: "clore", id, etat: "erreur", erreur: SERVEUR_INJOIGNABLE });
      } finally {
        if (annulation.current === controleur) annulation.current = null;
      }
    },
    [matricule],
  );

  const arreter = useCallback(() => annulation.current?.abort(), []);

  const nouvelle = useCallback(() => {
    annulation.current?.abort();
    dispatch({ type: "vider", notice: null });
  }, []);

  // Un autre salarié : une autre conversation
  const precedent = useRef(matricule);
  useEffect(() => {
    if (precedent.current === matricule) return;
    precedent.current = matricule;
    annulation.current?.abort();
    if (echanges.current.length > 0) dispatch({ type: "vider", notice: "Nouvelle conversation\u00a0: le salarié connecté a changé, l'historique précédent n'est plus envoyé." });
  }, [matricule]);

  const repondre = useCallback(
    async (echange: string, confirmation: string, accord: boolean) => {
      dispatch({ type: "confirmation", id: echange, confirmation, etat: "envoi" });
      try {
        const reponse = await fetch("/ask/confirmation", {
          method: "POST",
          headers: enTetes({ matricule, json: true }),
          body: JSON.stringify({ id: confirmation, accord }),
        });
        if (reponse.ok) dispatch({ type: "confirmation", id: echange, confirmation, etat: accord ? "accordee" : "refusee" });
        else dispatch({ type: "confirmation", id: echange, confirmation, etat: "erreur", erreur: await messageDErreur(reponse) });
      } catch {
        dispatch({ type: "confirmation", id: echange, confirmation, etat: "erreur", erreur: SERVEUR_INJOIGNABLE });
      }
    },
    [matricule],
  );

  // L'avis du salarié (leçon 7) : POST /retours, avec son matricule ; noter une seconde fois remplace la note
  const donnerAvis = useCallback(
    async (id: string, note: 1 | -1, commentaire: string) => {
      const echange = echanges.current.find((e) => e.id === id);
      const observation = echange?.fin?.observation;
      if (!observation) return;
      const texte = commentaire.trim();
      dispatch({ type: "avis", id, avis: { note, commentaire: texte, etat: "envoi" } });
      try {
        await appeler<{ ok: true }>("/retours", { matricule, corps: { observation, note, ...(texte && { commentaire: texte }) } });
        dispatch({ type: "avis", id, avis: { note, commentaire: texte, etat: "ok" } });
      } catch (erreur) {
        const e = erreur instanceof ErreurApi ? erreur : null;
        const message = e?.routeAbsente ? "Les avis arrivent à la leçon 7\u00a0: ce serveur ne les enregistre pas encore." : e?.statut === 404 ? "Réponse introuvable\u00a0: l'avis n'a pas été enregistré." : (e?.message ?? SERVEUR_INJOIGNABLE);
        dispatch({ type: "avis", id, avis: { note, commentaire: texte, etat: "erreur", erreur: message, absent: e?.routeAbsente } });
      }
    },
    [matricule],
  );

  const choisir = useCallback((id: string) => dispatch({ type: "selectionner", id }), []);
  const effacerNotice = useCallback(() => dispatch({ type: "effacer-notice" }), []);

  const valeur = useMemo<Valeur>(
    () => ({
      ...etat,
      enCours,
      envoyer: (q) => void envoyer(q),
      arreter,
      nouvelle,
      choisir,
      repondre: (e, c, a) => void repondre(e, c, a),
      donnerAvis: (e, n, c) => void donnerAvis(e, n, c),
      effacerNotice,
      historiqueEnvoye: historiqueDe(etat.echanges).length,
    }),
    [etat, enCours, envoyer, arreter, nouvelle, choisir, repondre, donnerAvis, effacerNotice],
  );
  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

export function useConversation(): Valeur {
  const v = useContext(Contexte);
  if (!v) throw new Error("useConversation hors de FournisseurConversation");
  return v;
}
