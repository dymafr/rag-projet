// Le salarié connecté. Ce projet n'a pas de vraie connexion : l'interface choisit un matricule, qui part dans l'en-tête
// X-Matricule de chaque appel, et le serveur lit son profil dans l'annuaire (chapitre 13). Retenu dans le navigateur
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useRequete, type EtatRequete } from "../api/requete.ts";
import { ecrireStockage, lireStockage } from "../outils/stockage.ts";
import type { FicheSalarie } from "../types.ts";
import { useServeur } from "./serveur.tsx";

const CLE = "rhea.matricule";
export const MATRICULE_PAR_DEFAUT = "K0101";
export const MOTIF_MATRICULE = /^K\d{4}$/;

type Valeur = {
  matricule: string;
  changerMatricule: (matricule: string) => void;
  salaries: EtatRequete<FicheSalarie[]>;
  fiche: FicheSalarie | undefined;
};

const Contexte = createContext<Valeur | null>(null);

function lireMatricule() {
  const m = lireStockage(CLE);
  return m && MOTIF_MATRICULE.test(m) ? m : MATRICULE_PAR_DEFAUT;
}

export function FournisseurSession({ children }: { children: ReactNode }) {
  const serveur = useServeur();
  const [matricule, setMatricule] = useState(lireMatricule);
  // L'annuaire n'existe qu'en mode inspection
  const salaries = useRequete<FicheSalarie[]>(serveur.inspection ? "/api/salaries" : null);
  const changerMatricule = useCallback((m: string) => {
    if (!MOTIF_MATRICULE.test(m)) return;
    setMatricule(m);
    ecrireStockage(CLE, m);
  }, []);
  const fiche = salaries.etat === "ok" ? salaries.donnees.find((s) => s.matricule === matricule) : undefined;
  const valeur = useMemo<Valeur>(() => ({ matricule, changerMatricule, salaries, fiche }), [matricule, changerMatricule, salaries, fiche]);
  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

export function useSession(): Valeur {
  const v = useContext(Contexte);
  if (!v) throw new Error("useSession hors de FournisseurSession");
  return v;
}

export const nomComplet = (s: FicheSalarie) => `${s.prenom} ${s.nom}`;
// Le site, avec sa majuscule : l'annuaire l'écrit en minuscules (lyon, nantes)
export const nomDuSite = (site: string) => site.charAt(0).toLocaleUpperCase("fr") + site.slice(1);
// « Morgane Moreau · salarie · Lyon »
export const libelleSalarie = (s: FicheSalarie) => `${nomComplet(s)} · ${s.role} · ${nomDuSite(s.site)}`;
