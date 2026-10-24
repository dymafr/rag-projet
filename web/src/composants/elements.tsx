// Les éléments de base : boutons, pastilles, barres de score, squelettes, états vides et d'erreur
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { pourcentage, score as formaterScore } from "../outils/format.ts";
import { Icone, type NomIcone } from "./Icone.tsx";

type Variante = "primaire" | "secondaire" | "fantome" | "danger";
type ProprietesBouton = ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; icone?: NomIcone; petit?: boolean };

export function Bouton({ variante = "secondaire", icone, petit, className, children, type = "button", ...autres }: ProprietesBouton) {
  const classes = ["bouton", `bouton-${variante}`, petit && "bouton-petit", className].filter(Boolean).join(" ");
  return (
    <button type={type} className={classes} {...autres}>
      {icone && <Icone nom={icone} taille={petit ? 14 : 16} />}
      {children}
    </button>
  );
}

// Un bouton sans texte visible : son libellé est lu par les lecteurs d'écran et s'affiche au survol
type ProprietesBoutonIcone = ButtonHTMLAttributes<HTMLButtonElement> & { icone: NomIcone; libelle: string; taille?: number };

export function BoutonIcone({ icone, libelle, taille = 16, className, type = "button", ...autres }: ProprietesBoutonIcone) {
  return (
    <button type={type} className={className ? `bouton-icone ${className}` : "bouton-icone"} aria-label={libelle} title={libelle} {...autres}>
      <Icone nom={icone} taille={taille} />
    </button>
  );
}

// Copier un texte en un clic : la coche dit que c'est fait, et la zone annoncée le dit aux lecteurs d'écran
export function BoutonCopier({ texte, libelle = "Copier", avecTexte = false }: { texte: string | (() => string); libelle?: string; avecTexte?: boolean }) {
  const [etat, setEtat] = useState<"repos" | "copie" | "echec">("repos");
  const minuterie = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(minuterie.current), []);
  const copier = async () => {
    try {
      await navigator.clipboard.writeText(typeof texte === "function" ? texte() : texte);
      setEtat("copie");
    } catch {
      setEtat("echec");
    }
    window.clearTimeout(minuterie.current);
    minuterie.current = window.setTimeout(() => setEtat("repos"), 1600);
  };
  const message = etat === "copie" ? "Copié" : etat === "echec" ? "Copie impossible" : "";
  return (
    <button
      type="button"
      className={`bouton-copier${avecTexte ? " avec-texte" : ""}${etat === "copie" ? " copie" : ""}`}
      onClick={copier}
      aria-label={libelle}
      title={libelle}
    >
      <Icone nom={etat === "copie" ? "coche" : "copier"} taille={14} />
      {avecTexte && <span>{etat === "copie" ? "Copié" : libelle}</span>}
      <span className="visuellement-cache" role="status">
        {message}
      </span>
    </button>
  );
}

export type Ton = "neutre" | "ok" | "alerte" | "erreur" | "info" | "accent" | "recherche" | "llm" | "decision" | "outil";

export function Pastille({ ton = "neutre", icone, children, titre, mono }: { ton?: Ton; icone?: NomIcone; children: ReactNode; titre?: string; mono?: boolean }) {
  return (
    <span className={`pastille pastille-${ton}${mono ? " mono" : ""}`} title={titre}>
      {icone && <Icone nom={icone} taille={12} />}
      {children}
    </span>
  );
}

// Un score sous forme de barre : rapport entre 0 et 1, et la valeur écrite à côté
export function BarreScore({ rapport, valeur, ton = "recherche", libelle }: { rapport: number; valeur?: string; ton?: Ton; libelle?: string }) {
  const borne = Math.max(0, Math.min(1, Number.isFinite(rapport) ? rapport : 0));
  return (
    <span className="barre-score">
      <span
        className={`barre-score-piste ton-${ton}`}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Number(borne.toFixed(3))}
        aria-label={libelle ?? "score"}
        aria-valuetext={valeur ?? pourcentage(borne)}
      >
        <span className="barre-score-rempli" style={{ width: `${borne * 100}%` }} />
      </span>
      <span className="barre-score-valeur">{valeur ?? formaterScore(rapport)}</span>
    </span>
  );
}

export function Squelette({ largeur = "100%", hauteur = 14, rond }: { largeur?: number | string; hauteur?: number; rond?: boolean }) {
  return <span className={`squelette${rond ? " rond" : ""}`} style={{ width: largeur, height: hauteur }} aria-hidden="true" />;
}

// Des lignes de squelette, pour une liste ou un tableau qui charge
export function SqueletteLignes({ lignes = 6, libelle = "Chargement" }: { lignes?: number; libelle?: string }) {
  return (
    <div className="squelette-lignes" role="status" aria-label={libelle}>
      {Array.from({ length: lignes }, (_, i) => (
        <div key={i} className="squelette-ligne">
          <Squelette largeur={`${18 + ((i * 7) % 10)}%`} />
          <Squelette largeur={`${46 + ((i * 13) % 30)}%`} />
          <Squelette largeur="10%" />
        </div>
      ))}
    </div>
  );
}

export function EtatVide({ icone = "info", titre, children, action }: { icone?: NomIcone; titre: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="etat-vide">
      <span className="etat-vide-icone">
        <Icone nom={icone} taille={20} />
      </span>
      <p className="etat-vide-titre">{titre}</p>
      {children && <div className="etat-vide-texte">{children}</div>}
      {action && <div className="etat-vide-action">{action}</div>}
    </div>
  );
}

// Une vue dont la route n'existe pas encore : elle arrive avec une leçon du chapitre 14
export function EtatLecon({ lecon, sujet, children }: { lecon: number; sujet: string; children?: ReactNode }) {
  return (
    <EtatVide icone="horloge" titre={`Cette vue s'allume à la leçon ${lecon} du chapitre 14 : ${sujet}`}>
      {children ?? "Le serveur n'a pas encore cette route\u00a0: elle arrive avec la leçon. Le reste de l'interface fonctionne déjà."}
    </EtatVide>
  );
}

export function EtatErreur({ titre = "Lecture impossible", message, reessayer }: { titre?: string; message: string; reessayer?: () => void }) {
  return (
    <div className="etat-vide etat-erreur" role="alert">
      <span className="etat-vide-icone">
        <Icone nom="alerte" taille={20} />
      </span>
      <p className="etat-vide-titre">{titre}</p>
      <div className="etat-vide-texte">{message}</div>
      {reessayer && (
        <div className="etat-vide-action">
          <Bouton icone="boucle" onClick={reessayer}>
            Réessayer
          </Bouton>
        </div>
      )}
    </div>
  );
}

// Une carte : un titre, des actions à droite, un contenu
export function Carte({ titre, icone, actions, children, className, id }: { titre?: ReactNode; icone?: NomIcone; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section className={className ? `carte ${className}` : "carte"} aria-labelledby={id && titre ? `${id}-titre` : undefined}>
      {(titre || actions) && (
        <header className="carte-entete">
          {titre && (
            <h3 className="carte-titre" id={id ? `${id}-titre` : undefined}>
              {icone && <Icone nom={icone} taille={16} />}
              {titre}
            </h3>
          )}
          {actions && <div className="carte-actions">{actions}</div>}
        </header>
      )}
      <div className="carte-corps">{children}</div>
    </section>
  );
}

// Une liste de définitions compacte : libellé à gauche, valeur à droite
export function Definitions({ lignes }: { lignes: [ReactNode, ReactNode][] }) {
  return (
    <dl className="definitions">
      {lignes.map(([terme, valeur], i) => (
        <div className="definition" key={i}>
          <dt>{terme}</dt>
          <dd>{valeur}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Raccourci({ touches }: { touches: string[] }) {
  return (
    <span className="raccourci">
      {touches.map((t, i) => (
        <kbd key={i}>{t}</kbd>
      ))}
    </span>
  );
}
