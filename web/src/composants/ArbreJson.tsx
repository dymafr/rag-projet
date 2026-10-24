// Un JSON lisible : un arbre repliable, les types en couleur, les identifiants de passage cliquables. Pour le détail brut
// de chaque étape, et le rendu de toute étape que l'interface ne connaît pas encore
import { useState } from "react";
import { nombre } from "../outils/format.ts";
import { estIdPassage, estObjet } from "../outils/lecture.ts";
import { BoutonCopier } from "./elements.tsx";
import { Icone } from "./Icone.tsx";
import { PastillePassage } from "./PastillePassage.tsx";

const LONGUEUR_APERCU = 400;

export function ArbreJson({ valeur, ouvert = 1, copier = true }: { valeur: unknown; ouvert?: number; copier?: boolean }) {
  return (
    <div className="arbre-json">
      {copier && (
        <div className="arbre-json-actions">
          <BoutonCopier texte={() => JSON.stringify(valeur, null, 2)} libelle="Copier le JSON" avecTexte />
        </div>
      )}
      <Noeud valeur={valeur} profondeur={0} ouvert={ouvert} />
    </div>
  );
}

function Noeud({ cle, valeur, profondeur, ouvert }: { cle?: string | number; valeur: unknown; profondeur: number; ouvert: number }) {
  const composite = Array.isArray(valeur) || estObjet(valeur);
  const [deplie, setDeplie] = useState(profondeur < ouvert);
  if (!composite) {
    return (
      <div className="json-ligne">
        <Cle cle={cle} />
        <Feuille valeur={valeur} />
      </div>
    );
  }
  const entrees: [string | number, unknown][] = Array.isArray(valeur) ? valeur.map((v, i) => [i, v]) : Object.entries(valeur as Record<string, unknown>);
  const [ouvrant, fermant] = Array.isArray(valeur) ? ["[", "]"] : ["{", "}"];
  if (entrees.length === 0) {
    return (
      <div className="json-ligne">
        <Cle cle={cle} />
        <span className="json-ponctuation">
          {ouvrant}
          {fermant}
        </span>
      </div>
    );
  }
  const resume = Array.isArray(valeur) ? `${nombre(entrees.length)} élément${entrees.length >= 2 ? "s" : ""}` : `${nombre(entrees.length)} clé${entrees.length >= 2 ? "s" : ""}`;
  return (
    <div className="json-noeud">
      <button type="button" className="json-basculer" aria-expanded={deplie} onClick={() => setDeplie((d) => !d)}>
        <Icone nom={deplie ? "chevron-bas" : "chevron-droite"} taille={12} />
        <Cle cle={cle} />
        <span className="json-ponctuation">{ouvrant}</span>
        {!deplie && (
          <>
            <span className="json-resume">{resume}</span>
            <span className="json-ponctuation">{fermant}</span>
          </>
        )}
      </button>
      {deplie && (
        <>
          <ul className="json-enfants">
            {entrees.map(([k, v]) => (
              <li key={k}>
                <Noeud cle={k} valeur={v} profondeur={profondeur + 1} ouvert={ouvert} />
              </li>
            ))}
          </ul>
          <span className="json-ponctuation json-fermant">{fermant}</span>
        </>
      )}
    </div>
  );
}

function Cle({ cle }: { cle?: string | number }) {
  if (cle === undefined) return null;
  return (
    <>
      <span className={typeof cle === "number" ? "json-indice" : "json-cle"}>{cle}</span>
      <span className="json-ponctuation">: </span>
    </>
  );
}

function Feuille({ valeur }: { valeur: unknown }) {
  if (valeur === null || valeur === undefined) return <span className="json-nul">null</span>;
  if (typeof valeur === "boolean") return <span className="json-mot">{String(valeur)}</span>;
  if (typeof valeur === "number") return <span className="json-nombre">{String(valeur)}</span>;
  if (typeof valeur === "string") return estIdPassage(valeur) ? <PastillePassage id={valeur} compacte /> : <ChaineJson texte={valeur} />;
  return <span>{String(valeur)}</span>;
}

// Une chaîne longue s'affiche en entier à la demande : rien ne reste tronqué sans moyen de le lire
function ChaineJson({ texte }: { texte: string }) {
  const [entiere, setEntiere] = useState(false);
  const longue = texte.length > LONGUEUR_APERCU;
  return (
    <span className="json-texte">
      "{longue && !entiere ? `${texte.slice(0, LONGUEUR_APERCU)}…` : texte}"
      {longue && (
        <button type="button" className="lien-bouton json-lire" onClick={() => setEntiere((e) => !e)}>
          {entiere ? "replier" : `lire tout (${nombre(texte.length)} caractères)`}
        </button>
      )}
    </span>
  );
}
