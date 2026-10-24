// L'état du serveur, lu une fois au chargement (et à la demande) : joignable ou non, en mode inspection ou non, et sa
// configuration. Sans inspection, l'interface sert encore à discuter avec Rhéa
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { appeler, ErreurApi } from "../api/client.ts";
import type { Configuration } from "../types.ts";

export type EtatServeur =
  | { etat: "chargement" }
  | { etat: "inspection"; configuration: Configuration }
  | { etat: "sans-inspection" }
  | { etat: "injoignable"; message: string }
  | { etat: "erreur"; message: string };

type Valeur = EtatServeur & { recharger: () => void; inspection: boolean | null };

const Contexte = createContext<Valeur | null>(null);

export function FournisseurServeur({ children }: { children: ReactNode }) {
  const [etat, setEtat] = useState<EtatServeur>({ etat: "chargement" });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const annulation = new AbortController();
    appeler<Configuration>("/api/configuration", { signal: annulation.signal }).then(
      (configuration) => setEtat({ etat: "inspection", configuration }),
      (erreur: unknown) => {
        if (annulation.signal.aborted) return;
        if (erreur instanceof ErreurApi && erreur.inspectionDesactivee) setEtat({ etat: "sans-inspection" });
        else if (erreur instanceof ErreurApi && erreur.injoignable) setEtat({ etat: "injoignable", message: erreur.message });
        else setEtat({ etat: "erreur", message: erreur instanceof Error ? erreur.message : String(erreur) });
      },
    );
    return () => annulation.abort();
  }, [version]);

  // Quand la fenêtre revient au premier plan, un serveur injoignable est relu : il vient peut-être d'être relancé
  useEffect(() => {
    if (etat.etat !== "injoignable") return;
    const relire = () => setVersion((v) => v + 1);
    window.addEventListener("focus", relire);
    return () => window.removeEventListener("focus", relire);
  }, [etat.etat]);

  const recharger = useCallback(() => setVersion((v) => v + 1), []);
  const valeur = useMemo<Valeur>(
    () => ({ ...etat, recharger, inspection: etat.etat === "inspection" ? true : etat.etat === "sans-inspection" ? false : null }),
    [etat, recharger],
  );
  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

export function useServeur(): Valeur {
  const v = useContext(Contexte);
  if (!v) throw new Error("useServeur hors de FournisseurServeur");
  return v;
}

export const configurationDe = (s: EtatServeur): Configuration | null => (s.etat === "inspection" ? s.configuration : null);
