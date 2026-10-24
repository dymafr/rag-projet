// Une lecture au serveur, pour une vue : son état (chargement, données, erreur), qui repart de zéro quand le chemin ou le
// salarié connecté change. Jamais les données d'avant pendant le chargement : elles venaient peut-être d'un autre profil
import { useCallback, useEffect, useState } from "react";
import { appeler, ErreurApi, estAbandon } from "./client.ts";

export type EtatRequete<T> = { etat: "chargement" } | { etat: "ok"; donnees: T } | { etat: "erreur"; erreur: ErreurApi };

export function useRequete<T>(chemin: string | null, matricule?: string): EtatRequete<T> & { recharger: () => void } {
  const [version, setVersion] = useState(0);
  const cle = chemin === null ? null : `${chemin}|${matricule ?? ""}|${version}`;
  const [lu, setLu] = useState<{ cle: string | null; valeur: EtatRequete<T> }>({ cle: null, valeur: { etat: "chargement" } });

  useEffect(() => {
    if (chemin === null || cle === null) return;
    const annulation = new AbortController();
    appeler<T>(chemin, { matricule, signal: annulation.signal }).then(
      (donnees) => setLu({ cle, valeur: { etat: "ok", donnees } }),
      (erreur: unknown) => {
        if (estAbandon(erreur)) return;
        const e = erreur instanceof ErreurApi ? erreur : new ErreurApi(0, String(erreur));
        setLu({ cle, valeur: { etat: "erreur", erreur: e } });
      },
    );
    return () => annulation.abort();
  }, [chemin, matricule, cle]);

  const recharger = useCallback(() => setVersion((v) => v + 1), []);
  const valeur: EtatRequete<T> = lu.cle === cle ? lu.valeur : { etat: "chargement" };
  return { ...valeur, recharger };
}
