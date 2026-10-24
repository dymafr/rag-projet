// Un long texte brut (des consignes, un message envoyé au LLM, ce qu'un outil a rendu) : en chasse fixe, à copier en un
// clic, replié au-delà d'une hauteur et dépliable en entier
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { nombre } from "../outils/format.ts";
import { BoutonCopier } from "./elements.tsx";
import { Icone } from "./Icone.tsx";
import { TexteAvecPassages } from "./PastillePassage.tsx";

type Proprietes = {
  texte: string;
  titre?: ReactNode;
  hauteurMax?: number;
  avecPassages?: boolean; // les identifiants de passage deviennent cliquables
  proportionnel?: boolean; // en police proportionnelle (un texte d'humain plutôt que du code)
};

export function BlocTexte({ texte, titre, hauteurMax = 280, avecPassages, proportionnel }: Proprietes) {
  const ref = useRef<HTMLPreElement>(null);
  const [deplie, setDeplie] = useState(false);
  const [deborde, setDeborde] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) setDeborde(el.scrollHeight > hauteurMax + 4);
  }, [texte, hauteurMax]);
  const lignes = texte.split("\n").length;
  return (
    <div className="bloc-texte">
      <div className="bloc-texte-entete">
        {titre && <span className="bloc-texte-titre">{titre}</span>}
        <span className="muet petit">
          {nombre(texte.length)} caractère{texte.length >= 2 ? "s" : ""}
          {lignes > 1 ? ` · ${nombre(lignes)} lignes` : ""}
        </span>
        <BoutonCopier texte={texte} libelle="Copier le texte" />
      </div>
      {texte.length === 0 ? (
        <p className="bloc-texte-vide muet">(texte vide)</p>
      ) : (
        <pre ref={ref} className={`bloc-texte-corps${proportionnel ? " proportionnel" : ""}`} style={deplie ? undefined : { maxHeight: hauteurMax }} tabIndex={deborde && !deplie ? 0 : undefined}>
          {avecPassages ? <TexteAvecPassages texte={texte} /> : texte}
        </pre>
      )}
      {deborde && (
        <button type="button" className="bloc-texte-deplier" onClick={() => setDeplie((d) => !d)} aria-expanded={deplie}>
          <Icone nom={deplie ? "chevron-haut" : "chevron-bas"} taille={14} />
          {deplie ? "Replier" : "Tout afficher"}
        </button>
      )}
    </div>
  );
}
