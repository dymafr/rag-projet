// L'état du serveur dans la barre du haut : joignable ou non, en mode inspection ou non, le modèle qui rédige, et, dès la
// leçon 8, la santé du service (GET /sante) : un disjoncteur ouvert se voit, et un clic ouvre le détail
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useServeur } from "../contextes/serveur.tsx";
import { niveauDe, useSante } from "../contextes/sante.ts";
import { nombre } from "../outils/format.ts";
import { Lien } from "../routeur.tsx";
import type { EtatDisjoncteur, Modele, Sante } from "../types.ts";
import { Pastille, type Ton } from "./elements.tsx";
import { Icone } from "./Icone.tsx";

const ETATS: Record<EtatDisjoncteur, { ton: Ton; libelle: string; explication: string }> = {
  ferme: { ton: "ok", libelle: "fermé", explication: "les appels passent" },
  ouvert: { ton: "erreur", libelle: "ouvert", explication: "fournisseur mis de côté après des échecs répétés" },
  "demi-ouvert": { ton: "alerte", libelle: "demi-ouvert", explication: "un appel d'essai décide de la suite" },
};

export function EtatDuServeur() {
  const serveur = useServeur();
  const sante = useSante();
  const [ouvert, setOuvert] = useState(false);
  const racine = useRef<HTMLDivElement>(null);
  const bouton = useRef<HTMLButtonElement>(null);
  const idDetail = useId();

  useEffect(() => {
    if (!ouvert) return;
    const fermer = (e: PointerEvent) => {
      if (racine.current && !racine.current.contains(e.target as Node)) setOuvert(false);
    };
    const echap = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOuvert(false);
      bouton.current?.focus();
    };
    document.addEventListener("pointerdown", fermer);
    document.addEventListener("keydown", echap);
    return () => {
      document.removeEventListener("pointerdown", fermer);
      document.removeEventListener("keydown", echap);
    };
  }, [ouvert]);

  const configuration = serveur.etat === "inspection" ? serveur.configuration : null;
  const avecSante = sante.etat === "ok";
  const niveau = avecSante ? niveauDe(sante.sante) : null;
  const disjoncteurOuvert = avecSante && (sante.sante.disjoncteurs ?? []).some((d) => d.etat === "ouvert");

  let ton: string;
  let texte: ReactNode;
  let titre: string;
  switch (serveur.etat) {
    case "chargement":
      ton = "neutre";
      texte = "Connexion…";
      titre = "Lecture de l'état du serveur";
      break;
    case "inspection": {
      const locale = serveur.configuration.destinations.find((d) => d.brique === "génération")?.locale ?? false;
      ton = niveau ?? "ok";
      texte = (
        <>
          <span>{disjoncteurOuvert ? "Disjoncteur ouvert" : niveau === "erreur" ? "Service dégradé" : "Serveur"}</span>
          <span className="etat-serveur-separateur" aria-hidden="true" />
          <Icone nom={locale ? "machine" : "globe"} taille={13} />
          <span className="mono">{serveur.configuration.generation.modele}</span>
        </>
      );
      titre = `Serveur joignable, mode inspection. Génération\u00a0: ${serveur.configuration.generation.fournisseur} ${serveur.configuration.generation.modele} (${locale ? "sur cette machine" : "en ligne"})`;
      break;
    }
    case "sans-inspection":
      ton = niveau === "erreur" ? "erreur" : "alerte";
      texte = disjoncteurOuvert ? "Disjoncteur ouvert" : "Serveur · sans inspection";
      titre = "Le serveur répond, sans le mode inspection\u00a0: on peut discuter, pas inspecter";
      break;
    case "injoignable":
      ton = "erreur";
      texte = "Serveur injoignable";
      titre = serveur.message;
      break;
    case "erreur":
      ton = "erreur";
      texte = "Serveur en erreur";
      titre = serveur.message;
      break;
  }

  // Sans la route de santé (avant la leçon 8) : l'indicateur d'avant, qui mène à la configuration
  if (!avecSante) {
    return (
      <div className={`etat-serveur ton-${ton}`} title={titre} role="status" aria-label={titre}>
        <span className="etat-serveur-point" aria-hidden="true" />
        {serveur.etat === "inspection" ? (
          <Lien vers="/configuration" className="etat-serveur-texte" aria-label={`${titre}\u00a0: voir la configuration`}>
            {texte}
          </Lien>
        ) : (
          <span className="etat-serveur-texte">{texte}</span>
        )}
        {(serveur.etat === "injoignable" || serveur.etat === "erreur") && (
          <button type="button" className="lien-bouton" onClick={serveur.recharger}>
            Réessayer
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="etat-serveur-conteneur" ref={racine}>
      <button
        ref={bouton}
        type="button"
        className={`etat-serveur ton-${ton} cliquable`}
        aria-expanded={ouvert}
        aria-controls={idDetail}
        aria-label={`${titre}. ${disjoncteurOuvert ? "Un disjoncteur est ouvert. " : ""}Santé du service\u00a0: afficher le détail`}
        title="Santé du service"
        onClick={() => {
          setOuvert((o) => !o);
          sante.relire();
        }}
      >
        <span className="etat-serveur-point" aria-hidden="true" />
        <span className="etat-serveur-texte">{texte}</span>
        <Icone nom="chevron-bas" taille={13} />
      </button>
      {ouvert && <DetailSante id={idDetail} sante={sante.sante} lue={sante.lue} configuration={configuration !== null} />}
    </div>
  );
}

function DetailSante({ id, sante, lue, configuration }: { id: string; sante: Sante; lue: number; configuration: boolean }) {
  const q = sante.questions;
  const disjoncteurs = sante.disjoncteurs ?? [];
  const etatDe = (m: Modele | null | undefined) => (m ? disjoncteurs.find((d) => d.nom === `${m.fournisseur} ${m.modele}`) : undefined);
  return (
    <div className="popover detail-sante" id={id} role="dialog" aria-label="Santé du service">
      <header className="detail-sante-entete">
        <Icone nom="activite" taille={16} />
        <span className="fort">Santé du service</span>
        <span className="muet petit">lue à {new Date(lue).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
      </header>
      <dl className="detail-sante-liste">
        <div>
          <dt>Service</dt>
          <dd>{sante.ok ? <Pastille ton="ok">répond</Pastille> : <Pastille ton="erreur">ne va pas bien</Pastille>}</dd>
        </div>
        {sante.base !== undefined && (
          <div>
            <dt>Base de données</dt>
            <dd>{sante.base ? <Pastille ton="ok">joignable</Pastille> : <Pastille ton="erreur">injoignable</Pastille>}</dd>
          </div>
        )}
        {sante.llm && (
          <>
            <LigneModele libelle="LLM principal" modele={sante.llm.principal} etat={etatDe(sante.llm.principal)?.etat} />
            {sante.llm.repli ? <LigneModele libelle="LLM de repli" modele={sante.llm.repli} etat={etatDe(sante.llm.repli)?.etat} /> : (
              <div>
                <dt>LLM de repli</dt>
                <dd className="muet">aucun</dd>
              </div>
            )}
          </>
        )}
      </dl>
      {disjoncteurs.length === 0 && <p className="muet petit">Aucun disjoncteur encore&nbsp;: ils naissent au premier appel de chaque fournisseur.</p>}
      {q && (
        <div className="detail-sante-file">
          <p className="surtitre">Questions</p>
          <Remplissage libelle="En cours" valeur={q.enCours} max={q.max} />
          <Remplissage libelle="En attente" valeur={q.enAttente} max={q.attenteMax} />
          <p className="muet petit">Au-delà de la file, Rhéa répond «&nbsp;réessayez dans quelques secondes&nbsp;» (503).</p>
        </div>
      )}
      {configuration && (
        <Lien vers="/configuration" className="detail-sante-lien">
          Voir la configuration <Icone nom="fleche-droite" taille={13} />
        </Lien>
      )}
    </div>
  );
}

function LigneModele({ libelle, modele, etat }: { libelle: string; modele: Modele; etat?: EtatDisjoncteur }) {
  const e = etat ? ETATS[etat] : undefined;
  return (
    <div>
      <dt>{libelle}</dt>
      <dd>
        <span className="mono petit">
          {modele.fournisseur} {modele.modele}
        </span>
        {e ? (
          <span className="detail-sante-disjoncteur" title={e.explication}>
            <Pastille ton={e.ton}>disjoncteur {e.libelle}</Pastille>
          </span>
        ) : (
          <span className="muet petit"> · pas encore appelé</span>
        )}
      </dd>
    </div>
  );
}

function Remplissage({ libelle, valeur, max }: { libelle: string; valeur: number; max: number }) {
  const rapport = max > 0 ? Math.min(1, valeur / max) : 0;
  return (
    <div className="remplissage">
      <span>{libelle}</span>
      <span className="remplissage-piste" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={valeur} aria-label={`${libelle}\u00a0: ${valeur} sur ${max}`}>
        <span className={rapport >= 1 ? "plein" : ""} style={{ width: `${rapport * 100}%` }} />
      </span>
      <span className="mono petit">
        {nombre(valeur)} / {nombre(max)}
      </span>
    </div>
  );
}
