// Ouvrir un passage, de n'importe où : une citation, une ligne de tableau, un identifiant dans un JSON. Le passage se relit
// sur le serveur avec les droits du salarié connecté (GET /api/passages/:id) et s'affiche dans un tiroir
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { TiroirPassage, type DemandePassage } from "../composants/TiroirPassage.tsx";

type Ouvrir = (id: string, repli?: DemandePassage["repli"]) => void;

const Contexte = createContext<Ouvrir>(() => undefined);

export function FournisseurPassage({ children }: { children: ReactNode }) {
  const [demande, setDemande] = useState<DemandePassage | null>(null);
  const ouvrir = useCallback<Ouvrir>((id, repli) => setDemande({ id, repli }), []);
  const fermer = useCallback(() => setDemande(null), []);
  return (
    <Contexte.Provider value={ouvrir}>
      {children}
      {demande && <TiroirPassage key={demande.id} demande={demande} onFermer={fermer} />}
    </Contexte.Provider>
  );
}

export const useOuvrirPassage = () => useContext(Contexte);
