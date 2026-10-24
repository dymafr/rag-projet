// Le détail d'une étape : son en-tête (titre, statut, début, durée), son résumé entier, le rendu propre à son nom, et ses
// données brutes. Un rendu qui échoue (une donnée inattendue) laisse place au rendu générique : rien ne casse la page
import { Component, useLayoutEffect, useRef, type ReactNode } from "react";
import { ArbreJson } from "../composants/ArbreJson.tsx";
import { BoutonIcone, EtatVide, Pastille } from "../composants/elements.tsx";
import { Icone } from "../composants/Icone.tsx";
import { duree as formaterDuree, nombre, typographie } from "../outils/format.ts";
import { estTerminee, type EtapeTracee, type EtapeVue, type Tarifs } from "../types.ts";
import { familleDe, FAMILLES, iconeDe } from "./familles.ts";
import type { ContexteRendu } from "./rendus/communs.tsx";
import { RENDUS, RenduGenerique } from "./rendus/index.tsx";

type Proprietes = { etape: EtapeVue; etapes: EtapeVue[]; tarifs: Tarifs | null; maintenant: number; onFermer: () => void };

export function DetailEtape({ etape, etapes, tarifs, maintenant, onFermer }: Proprietes) {
  const corps = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    corps.current?.scrollTo({ top: 0 });
  }, [etape.id]);
  const famille = familleDe(etape.nom);
  const terminee = estTerminee(etape);
  const duree = terminee ? etape.duree_ms : Math.max(0, maintenant - etape.debut_ms);
  const contexte: ContexteRendu = { tarifs, etapes };
  return (
    <section className={`detail-etape famille-${famille}`} aria-labelledby="detail-etape-titre">
      <header className="detail-entete">
        <span className="detail-icone" aria-hidden="true">
          <Icone nom={iconeDe(etape.nom)} taille={16} />
        </span>
        <div className="detail-titres">
          <h3 id="detail-etape-titre">{etape.titre}</h3>
          <p className="detail-meta">
            <span className="mono">{etape.nom}</span>
            <span aria-hidden="true">·</span>
            <span>{FAMILLES[famille]}</span>
            <span aria-hidden="true">·</span>
            <span>étape n°&nbsp;{nombre(etape.id)}</span>
            <span aria-hidden="true">·</span>
            <span>début à {formaterDuree(etape.debut_ms)}</span>
            <span aria-hidden="true">·</span>
            <span>{terminee && etape.duree_ms === 0 ? "instantanée" : `durée ${formaterDuree(duree)}`}</span>
          </p>
        </div>
        <StatutEtape etape={etape} />
        <BoutonIcone icone="croix" libelle="Fermer le détail (Échap)" onClick={onFermer} />
      </header>
      <div className="detail-corps" ref={corps} tabIndex={-1}>
        {!terminee ? (
          etape.statut === "interrompue" ? (
            <EtatVide icone="interdit" titre="Étape interrompue">
              La réponse s'est arrêtée avant la fin de cette étape&nbsp;: son détail n'est jamais arrivé.
            </EtatVide>
          ) : (
            <EtatVide icone="horloge" titre="Étape en cours">
              Son détail s'affichera dès qu'elle sera finie.
            </EtatVide>
          )
        ) : (
          <>
            <p className={`detail-resume${etape.statut === "erreur" ? " erreur" : ""}`}>{typographie(etape.resume)}</p>
            <GardeRendu key={etape.id} secours={<RenduGenerique etape={etape} contexte={contexte} />}>
              <RenduDeLEtape etape={etape} contexte={contexte} />
            </GardeRendu>
            <details className="detail-brut">
              <summary>
                <Icone nom="chevron-droite" taille={12} className="detail-brut-chevron" />
                Données brutes (JSON)
              </summary>
              <ArbreJson valeur={etape} ouvert={1} />
            </details>
          </>
        )}
      </div>
    </section>
  );
}

function RenduDeLEtape({ etape, contexte }: { etape: EtapeTracee; contexte: ContexteRendu }) {
  const Rendu = RENDUS[etape.nom] ?? RenduGenerique;
  return <Rendu etape={etape} contexte={contexte} />;
}

function StatutEtape({ etape }: { etape: EtapeVue }) {
  if (etape.statut === "en-cours") return <Pastille ton="info">en cours</Pastille>;
  if (etape.statut === "interrompue") return <Pastille>interrompue</Pastille>;
  if (etape.statut === "erreur") return <Pastille ton="erreur" icone="erreur">erreur</Pastille>;
  return <Pastille ton="ok" icone="coche">ok</Pastille>;
}

class GardeRendu extends Component<{ secours: ReactNode; children: ReactNode }, { echec: boolean }> {
  state = { echec: false };

  static getDerivedStateFromError() {
    return { echec: true };
  }

  render() {
    return this.state.echec ? this.props.secours : this.props.children;
  }
}
