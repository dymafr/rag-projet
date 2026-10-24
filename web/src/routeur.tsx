// Le routeur de l'interface : l'adresse du navigateur (History API) décide de la vue. Le serveur rend la même page pour
// toute adresse sans extension : un lien copié, ou la touche F5, ramènent à la même vue
import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";

export type Route =
  | { vue: "conversation" }
  | { vue: "recherche" }
  | { vue: "index" }
  | { vue: "document"; document: string }
  | { vue: "evaluations" }
  | { vue: "execution"; nom: string }
  | { vue: "question"; nom: string; id: string }
  | { vue: "observabilite" }
  | { vue: "configuration" }
  | { vue: "introuvable"; chemin: string };

const CHANGEMENT = "rhea:navigation";

export function lireRoute(chemin: string): Route {
  const morceaux = chemin
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean)
    .map((m) => {
      try {
        return decodeURIComponent(m);
      } catch {
        return m;
      }
    });
  const [premier, deuxieme, troisieme] = morceaux;
  if (morceaux.length === 0) return { vue: "conversation" };
  if (premier === "recherche" && morceaux.length === 1) return { vue: "recherche" };
  if (premier === "index" && morceaux.length === 1) return { vue: "index" };
  if (premier === "index" && morceaux.length === 2) return { vue: "document", document: deuxieme };
  if (premier === "evaluations" && morceaux.length === 1) return { vue: "evaluations" };
  if (premier === "evaluations" && morceaux.length === 2) return { vue: "execution", nom: deuxieme };
  if (premier === "evaluations" && morceaux.length === 3) return { vue: "question", nom: deuxieme, id: troisieme };
  if (premier === "observabilite" && morceaux.length === 1) return { vue: "observabilite" };
  if (premier === "configuration" && morceaux.length === 1) return { vue: "configuration" };
  return { vue: "introuvable", chemin };
}

export function naviguer(adresse: string, options: { remplacer?: boolean } = {}) {
  const actuelle = location.pathname + location.search + location.hash;
  if (adresse === actuelle) return;
  if (options.remplacer) history.replaceState(null, "", adresse);
  else history.pushState(null, "", adresse);
  window.dispatchEvent(new Event(CHANGEMENT));
}

function abonner(rappel: () => void) {
  window.addEventListener("popstate", rappel);
  window.addEventListener(CHANGEMENT, rappel);
  return () => {
    window.removeEventListener("popstate", rappel);
    window.removeEventListener(CHANGEMENT, rappel);
  };
}

const lireAdresse = () => location.pathname + location.search;

// L'adresse courante (chemin et paramètres), qui fait se redessiner la vue quand elle change
export function useAdresse(): { chemin: string; parametres: URLSearchParams } {
  const adresse = useSyncExternalStore(abonner, lireAdresse);
  const url = new URL(adresse, location.origin);
  return { chemin: url.pathname, parametres: url.searchParams };
}

export const useRoute = (): Route => lireRoute(useAdresse().chemin);

// Changer un paramètre de l'adresse (un filtre, un tri) sans ajouter d'entrée à l'historique
export function changerParametres(changements: Record<string, string | null>) {
  const url = new URL(location.href);
  for (const [cle, valeur] of Object.entries(changements)) {
    if (valeur === null || valeur === "") url.searchParams.delete(cle);
    else url.searchParams.set(cle, valeur);
  }
  naviguer(url.pathname + url.search + url.hash, { remplacer: true });
}

// Un lien interne : un clic simple change de vue sans recharger la page ; Ctrl+clic ou le clic du milieu ouvrent un
// nouvel onglet, comme pour tout lien
type ProprietesLien = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { vers: string; children: ReactNode };

export function Lien({ vers, onClick, children, ...autres }: ProprietesLien) {
  const cliquer = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    naviguer(vers);
  };
  return (
    <a href={vers} onClick={cliquer} {...autres}>
      {children}
    </a>
  );
}

export const cheminDuDocument = (document: string) => `/index/${encodeURIComponent(document)}`;
export const cheminDeLExecution = (nom: string) => `/evaluations/${encodeURIComponent(nom)}`;
export const cheminDeLaQuestion = (nom: string, id: string) => `/evaluations/${encodeURIComponent(nom)}/${encodeURIComponent(id)}`;
