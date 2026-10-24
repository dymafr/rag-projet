// Un identifiant de passage, partout cliquable : il ouvre le passage dans le tiroir
import { Fragment, type ReactNode } from "react";
import { useOuvrirPassage } from "../contextes/passage.tsx";
import { MOTIF_PASSAGES_DANS_TEXTE } from "../outils/lecture.ts";

type Proprietes = {
  id: string;
  inventee?: boolean; // une source citée qu'aucun outil n'a rendue (chapitre 10)
  repli?: { titre?: string; texte?: string; score?: number };
  compacte?: boolean;
};

export function PastillePassage({ id, inventee, repli, compacte }: Proprietes) {
  const ouvrir = useOuvrirPassage();
  const libelle = inventee ? `Source inventée ${id}\u00a0: aucun outil ne l'a rendue. Ouvrir le passage` : `Ouvrir le passage ${id}`;
  return (
    <button
      type="button"
      className={`pastille-passage${inventee ? " inventee" : ""}${compacte ? " compacte" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        ouvrir(id, repli);
      }}
      aria-label={libelle}
      title={libelle}
    >
      {id}
    </button>
  );
}

// Un texte libre (un résultat d'outil, un message) où chaque identifiant de passage devient cliquable ; le reste reste du
// texte, jamais du HTML
export function TexteAvecPassages({ texte }: { texte: string }) {
  const morceaux: ReactNode[] = [];
  let dernier = 0;
  for (const m of texte.matchAll(MOTIF_PASSAGES_DANS_TEXTE)) {
    const debut = m.index ?? 0;
    if (debut > dernier) morceaux.push(texte.slice(dernier, debut));
    morceaux.push(<PastillePassage key={`${debut}-${m[0]}`} id={m[0]} compacte />);
    dernier = debut + m[0].length;
  }
  if (dernier < texte.length) morceaux.push(texte.slice(dernier));
  return (
    <>
      {morceaux.map((m, i) => (
        <Fragment key={i}>{m}</Fragment>
      ))}
    </>
  );
}
