// Les exécutions d'évaluation : score, réussite par type, coût, durée, configuration ; et la comparaison de deux
// exécutions du jeu de travail (?comparer=A&avec=B)
import { useState } from "react";
import { useRequete } from "../api/requete.ts";
import { LECONS } from "../api/client.ts";
import { Bouton, Carte, EtatErreur, EtatLecon, EtatVide, SqueletteLignes } from "../composants/elements.tsx";
import { useServeur } from "../contextes/serveur.tsx";
import { cout as formaterCout, date as formaterDate, duree as formaterDuree, nombre, pluriel } from "../outils/format.ts";
import { cheminDeLExecution, Lien, naviguer, useAdresse } from "../routeur.tsx";
import type { ResumeExecution } from "../types.ts";
import { Comparaison } from "./evaluations/Comparaison.tsx";
import { AnneauScore, BarresBilan, libelleType, PastilleJeu } from "./evaluations/communs.tsx";

export function VueEvaluations() {
  const serveur = useServeur();
  const { parametres } = useAdresse();
  const executions = useRequete<ResumeExecution[]>(serveur.inspection ? "/api/evaluations" : null);
  const a = parametres.get("comparer");
  const b = parametres.get("avec");

  if (serveur.inspection === false) {
    return (
      <div className="vue-page">
        <EtatVide icone="cadenas" titre="Inspection désactivée">
          Le serveur tourne sans le mode inspection&nbsp;: les évaluations ne sont pas lisibles.
        </EtatVide>
      </div>
    );
  }

  return (
    <div className="vue-page">
      <div className="vue-page-contenu">
        {a && b ? (
          executions.etat === "ok" ? (
            <Comparaison executions={executions.donnees} a={a} b={b} />
          ) : executions.etat === "erreur" ? (
            executions.erreur.routeAbsente ? <EtatLecon lecon={LECONS.evaluations.lecon} sujet={LECONS.evaluations.sujet}>Les évaluations de la production arrivent avec la leçon 2&nbsp;: le jeu de travail, le jeu caché, et chaque exécution de npm run eval:production.</EtatLecon> : <EtatErreur message={executions.erreur.message} reessayer={executions.recharger} />
          ) : (
            <SqueletteLignes lignes={8} />
          )
        ) : (
          <ListeDesExecutions etat={executions} />
        )}
      </div>
    </div>
  );
}

function ListeDesExecutions({ etat }: { etat: ReturnType<typeof useRequete<ResumeExecution[]>> }) {
  const [choisies, setChoisies] = useState<string[]>([]);
  const basculer = (nom: string) => setChoisies((c) => (c.includes(nom) ? c.filter((n) => n !== nom) : [...c.slice(-1), nom]));
  return (
    <>
      <header className="entete-de-page">
        <div className="entete-de-page-titres">
          <h1>Évaluations</h1>
          <p>
            Chaque exécution de npm run eval:production&nbsp;: le score sur les questions jugées, la réussite par type, ce qu'elle a coûté et la configuration
            évaluée. Cochez deux exécutions du jeu de travail pour les comparer, question par question.
          </p>
        </div>
        <Bouton
          variante="primaire"
          icone="comparer"
          disabled={choisies.length !== 2}
          onClick={() => naviguer(`/evaluations?comparer=${encodeURIComponent(choisies[0])}&avec=${encodeURIComponent(choisies[1])}`)}
        >
          Comparer {choisies.length === 2 ? "les deux" : `(${choisies.length}/2)`}
        </Bouton>
      </header>
      {etat.etat === "chargement" ? (
        <SqueletteLignes lignes={6} libelle="Chargement des évaluations" />
      ) : etat.etat === "erreur" ? (
        etat.erreur.routeAbsente ? <EtatLecon lecon={LECONS.evaluations.lecon} sujet={LECONS.evaluations.sujet}>Les évaluations de la production arrivent avec la leçon 2&nbsp;: le jeu de travail, le jeu caché, et chaque exécution de npm run eval:production.</EtatLecon> : <EtatErreur message={etat.erreur.message} reessayer={etat.recharger} />
      ) : etat.donnees.length === 0 ? (
        <EtatVide icone="evaluations" titre="Aucune évaluation">
          Lancez une exécution, par exemple <span className="mono">npm run eval:production -- --nom essai</span>&nbsp;: elle apparaîtra ici.
        </EtatVide>
      ) : (
        <ul className="liste-executions">
          {etat.donnees.map((e) => (
            <li key={e.nom}>
              <CarteExecution execution={e} choisie={choisies.includes(e.nom)} onBasculer={() => basculer(e.nom)} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function CarteExecution({ execution: e, choisie, onBasculer }: { execution: ResumeExecution; choisie: boolean; onBasculer: () => void }) {
  const nonJugees = e.bilan.total - e.bilan.jugees;
  return (
    <Carte className={`carte-execution${choisie ? " choisie" : ""}`}>
      <div className="carte-execution-grille">
        <div className="carte-execution-score">
          <AnneauScore bilan={e.bilan} />
          <div>
            <p className="carte-execution-chiffre">
              {nombre(e.bilan.reussies)} réussie{e.bilan.reussies >= 2 ? "s" : ""} <span className="muet">sur {nombre(e.bilan.jugees)} jugée{e.bilan.jugees >= 2 ? "s" : ""}</span>
            </p>
            <p className="muet petit">
              {pluriel(e.bilan.total, "question")}
              {nonJugees > 0 ? `, ${pluriel(nonJugees, "non jugée", "non jugées")}` : ""}
            </p>
          </div>
        </div>
        <div className="carte-execution-identite">
          <div className="carte-execution-titre">
            <Lien vers={cheminDeLExecution(e.nom)} className="mono fort">
              {e.nom}
            </Lien>
            <PastilleJeu jeu={e.jeu} />
          </div>
          <p className="muet petit">
            {formaterDate(e.date)} · {formaterDuree(e.duree_ms)} · {e.cout === null ? "coût nul (modèles locaux)" : formaterCout(e.cout)}
          </p>
          <dl className="configuration-courte">
            <div>
              <dt>Génération</dt>
              <dd className="mono">{e.configuration.generation}</dd>
            </div>
            <div>
              <dt>Juge</dt>
              <dd className="mono">{e.configuration.juge}</dd>
            </div>
            <div>
              <dt>Embeddings</dt>
              <dd className="mono">{e.configuration.embeddings}</dd>
            </div>
            <div>
              <dt>Reclasseur</dt>
              <dd className="mono">{e.configuration.reclasseur ?? "aucun"}</dd>
            </div>
            <div>
              <dt>Recherche</dt>
              <dd>{e.configuration.recherche}</dd>
            </div>
            <div>
              <dt>Prompt</dt>
              <dd className="mono">{e.configuration.prompt}</dd>
            </div>
          </dl>
        </div>
        <div className="carte-execution-types">
          <BarresBilan groupes={e.bilan.parType} libelle={libelleType} />
        </div>
        <div className="carte-execution-actions">
          {e.jeu === "travail" ? (
            <label className="case-a-cocher">
              <input type="checkbox" checked={choisie} onChange={onBasculer} aria-label={`Comparer ${e.nom}`} />
              Comparer
            </label>
          ) : (
            <span className="muet petit">scores seulement</span>
          )}
          <Lien vers={cheminDeLExecution(e.nom)} className="bouton bouton-secondaire bouton-petit">
            Ouvrir
          </Lien>
        </div>
      </div>
    </Carte>
  );
}
