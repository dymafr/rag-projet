// La santé du service (leçon 8) : GET /sante, relu toutes les 15 secondes tant que la page est visible. Avant la leçon 8,
// la route n'existe pas : l'indicateur se masque, sans erreur
import { useCallback, useEffect, useState } from "react";
import { estObjet } from "../outils/lecture.ts";
import type { Sante } from "../types.ts";

export type EtatSante = { etat: "chargement" } | { etat: "absente" } | { etat: "injoignable" } | { etat: "ok"; sante: Sante; lue: number };

const PERIODE_MS = 15_000;

async function lireSante(signal: AbortSignal): Promise<EtatSante> {
  try {
    const reponse = await fetch("/sante", { headers: { Accept: "application/json" }, cache: "no-store", signal });
    // 503 : le service répond qu'il ne va pas bien, avec le même corps ; 404 ou une page HTML : la route n'existe pas encore
    if (!reponse.headers.get("content-type")?.includes("json")) return { etat: reponse.status === 502 || reponse.status === 504 ? "injoignable" : "absente" };
    const corps: unknown = await reponse.json();
    if (reponse.status === 404 || !estObjet(corps) || typeof corps.ok !== "boolean") return { etat: "absente" };
    return { etat: "ok", sante: corps as Sante, lue: Date.now() };
  } catch (erreur) {
    if (erreur instanceof DOMException && erreur.name === "AbortError") throw erreur;
    return { etat: "injoignable" };
  }
}

export function useSante(): EtatSante & { relire: () => void } {
  const [etat, setEtat] = useState<EtatSante>({ etat: "chargement" });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const annulation = new AbortController();
    let minuterie: number | undefined;
    let premier = true;
    // La première lecture se fait toujours ; les suivantes, seulement quand la page est visible
    const tour = async () => {
      window.clearTimeout(minuterie);
      if (premier || document.visibilityState === "visible") {
        premier = false;
        try {
          const lu = await lireSante(annulation.signal);
          setEtat(lu);
          if (lu.etat === "absente") return; // inutile d'insister : la route arrivera avec une autre version du serveur
        } catch {
          return; // abandon
        }
      }
      minuterie = window.setTimeout(tour, PERIODE_MS);
    };
    const auRetour = () => {
      if (document.visibilityState === "visible") void tour();
    };
    void tour();
    document.addEventListener("visibilitychange", auRetour);
    return () => {
      annulation.abort();
      window.clearTimeout(minuterie);
      document.removeEventListener("visibilitychange", auRetour);
    };
  }, [version]);
  const relire = useCallback(() => setVersion((v) => v + 1), []);
  return { ...etat, relire };
}

// Le pire état parmi les disjoncteurs : un seul ouvert suffit à le voir
export function niveauDe(s: Sante): "ok" | "alerte" | "erreur" {
  const etats = (s.disjoncteurs ?? []).map((d) => d.etat);
  if (!s.ok || etats.includes("ouvert")) return "erreur";
  if (etats.includes("demi-ouvert")) return "alerte";
  return "ok";
}
