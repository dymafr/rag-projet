// La configuration du serveur (GET /api/configuration) : une carte par brique, les réglages de la recherche, le seuil
// d'abstention, le budget, les limites de l'agent, le prompt, l'index, où partent les données et les tarifs
import type { ReactNode } from "react";
import { ArbreJson } from "../composants/ArbreJson.tsx";
import { BoutonCopier, Carte, Definitions, EtatErreur, EtatVide, Pastille, SqueletteLignes } from "../composants/elements.tsx";
import { Icone } from "../composants/Icone.tsx";
import { useServeur } from "../contextes/serveur.tsx";
import { date as formaterDate, decimal, nombre, tokens as formaterTokens } from "../outils/format.ts";
import { estObjet } from "../outils/lecture.ts";
import { estLocal } from "../pipeline/calculs.ts";
import type { Configuration } from "../types.ts";

const CONNUES = new Set(["generation", "repli", "cache", "juge", "embeddings", "reclasseur", "recherche", "seuil", "budget", "agent", "prompt", "index", "destinations", "tarifs"]);

export function VueConfiguration() {
  const serveur = useServeur();
  return (
    <div className="vue-page">
      <div className="vue-page-contenu">
        <header className="entete-de-page">
          <div className="entete-de-page-titres">
            <h1>Configuration</h1>
            <p>Ce que sert le serveur en ce moment&nbsp;: les modèles de chaque brique, les réglages de la recherche, les garde-fous de l'agent, et où partent les données.</p>
          </div>
        </header>
        {serveur.etat === "chargement" ? (
          <SqueletteLignes lignes={8} />
        ) : serveur.etat === "sans-inspection" ? (
          <EtatVide icone="cadenas" titre="Inspection désactivée">
            Le serveur tourne sans le mode inspection&nbsp;: sa configuration reste privée (en production, elle en dirait trop).
          </EtatVide>
        ) : serveur.etat === "injoignable" || serveur.etat === "erreur" ? (
          <EtatErreur message={serveur.message} reessayer={serveur.recharger} />
        ) : (
          <ContenuConfiguration c={serveur.configuration} />
        )}
      </div>
    </div>
  );
}

const oui = (v: boolean) => (v ? <Pastille ton="ok">activé</Pastille> : <Pastille>désactivé</Pastille>);
const mono = (t: ReactNode) => <span className="mono">{t}</span>;

function ContenuConfiguration({ c }: { c: Configuration }) {
  const locale = (brique: string) => c.destinations.find((d) => d.brique === brique)?.locale;
  const autres = Object.entries(c as unknown as Record<string, unknown>).filter(([k]) => !CONNUES.has(k));
  const sorties = c.destinations.filter((d) => !d.locale).length;
  return (
    <>
      <div className="grille-configuration">
        <Carte titre="Génération" icone="etincelle" actions={<PastilleLieu locale={locale("génération")} />}>
          <Definitions lignes={[["Fournisseur", c.generation.fournisseur], ["Modèle", mono(c.generation.modele)]]} />
        </Carte>
        {c.repli !== undefined && (
          <Carte titre="Repli de fournisseur" icone="relais" actions={c.repli ? <PastilleLieu locale={estLocal(c.repli.fournisseur)} /> : undefined}>
            {c.repli ? (
              <Definitions lignes={[["Fournisseur", c.repli.fournisseur], ["Modèle", mono(c.repli.modele)]]} />
            ) : (
              <p className="muet petit">Aucun&nbsp;: si le LLM principal tombe, Rhéa rend les passages les plus proches, sans réponse rédigée.</p>
            )}
          </Carte>
        )}
        <Carte titre="Juge d'évaluation" icone="evaluations" actions={<PastilleLieu locale={locale("juge d'évaluation")} />}>
          <Definitions lignes={[["Fournisseur", c.juge.fournisseur], ["Modèle", mono(c.juge.modele)]]} />
        </Carte>
        <Carte titre="Embeddings" icone="vecteur" actions={<PastilleLieu locale={locale("embeddings")} />}>
          <Definitions
            lignes={[
              ["Fournisseur", c.embeddings.fournisseur],
              ["Modèle", mono(c.embeddings.modele)],
              ["Dimensions", c.embeddings.dimensions === null ? "–" : nombre(c.embeddings.dimensions)],
            ]}
          />
        </Carte>
        <Carte titre="Reclasseur" icone="tri" actions={<PastilleLieu locale={locale("reclassement")} />}>
          <Definitions lignes={[...(c.reclasseur.fournisseur ? ([["Fournisseur", c.reclasseur.fournisseur]] as [string, string][]) : []), ["Modèle", mono(c.reclasseur.modele)], ["Reclassement", oui(c.reclasseur.actif)]]} />
        </Carte>
      </div>

      <div className="grille-configuration deux">
        <Carte titre="Réglages de la recherche" icone="recherche">
          <Definitions
            lignes={[
              ["Mode", <Pastille ton="recherche">{c.recherche.mode}</Pastille>],
              ["Candidats par recherche", nombre(c.recherche.candidats)],
              ["Poids", <>vectorielle {decimal(c.recherche.poids[0], 1)}, plein texte {decimal(c.recherche.poids[1], 1)}</>],
              ["Vocabulaire de Kalyo", oui(c.recherche.vocabulaire)],
              ["Reclassement", c.recherche.reclassement ? <>{oui(true)} {mono(c.recherche.reclasseur)}</> : oui(false)],
              ["Transformation de la question", c.recherche.transformation ? <Pastille ton="ok">{c.recherche.transformation}</Pastille> : oui(false)],
              ["Filtres extraits de la question", oui(c.recherche.filtresExtraits)],
              ["Condensation des questions de suite", oui(c.recherche.condensation)],
              ["Diversité (MMR)", c.recherche.diversite === null ? oui(false) : <>lambda {decimal(c.recherche.diversite, 2)}</>],
            ]}
          />
        </Carte>
        <div className="pile-cartes">
          {c.seuil.plancher !== undefined ? (
            <Carte titre="Plancher de similarité" icone="jauge">
              <Definitions
                lignes={[
                  [
                    "Plancher",
                    c.seuil.plancher === null ? <>aucun <span className="muet petit">non mesuré pour ce modèle d'embedding</span></> : mono(decimal(c.seuil.plancher, 2)),
                  ],
                  ["Ancien seuil d'abstention", <>{mono(decimal(c.seuil.valeur, 2))} <span className="muet petit">mesuré avec {c.seuil.mesureAvec}</span></>],
                ]}
              />
              <p className="note-rendu">
                <Icone nom="info" taille={14} /> Sous le plancher, rien ne vaut la peine d'être lu. Au-dessus, ce n'est plus la proximité d'un passage qui décide,
                mais l'agent : il lit les passages et dit quand ils ne répondent pas.
              </p>
            </Carte>
          ) : (
            <Carte titre="Seuil d'abstention" icone="jauge">
              <Definitions
                lignes={[
                  ["Valeur", mono(decimal(c.seuil.valeur, 2))],
                  ["Mesuré avec", mono(c.seuil.mesureAvec)],
                ]}
              />
              {!c.seuil.aJour && (
                <p className="note-rendu alerte">
                  <Icone nom="alerte" taille={14} /> Le seuil a été mesuré avec {c.seuil.mesureAvec}, pas avec le modèle d'embedding actuel ({c.embeddings.nom})&nbsp;: relancez
                  npm run seuils.
                </p>
              )}
            </Carte>
          )}
          <Carte titre="Budget de passages" icone="pile">
            <Definitions lignes={[["Passages demandés", nombre(c.budget.passagesDemandes)], ["Budget", formaterTokens(c.budget.tokens)]]} />
          </Carte>
          <Carte titre="Limites de l'agent" icone="drapeau">
            <Definitions
              lignes={[
                ["Tours au plus", nombre(c.agent.toursMax)],
                ["Tokens par question", formaterTokens(c.agent.tokensMax)],
                ["Appels par outil", nombre(c.agent.appelsParOutil)],
                ["Première recherche", c.agent.recherche === "secours" ? "secours\u00a0: le code cherche si le LLM ne le fait pas" : c.agent.recherche],
              ]}
            />
          </Carte>
        </div>
      </div>

      {(c.agent.verification !== undefined || c.cache !== undefined) && (
        <div className="grille-configuration deux">
          {c.agent.verification !== undefined && (
            <Carte titre="Vérification de la réponse" icone="evaluations" actions={oui(c.agent.verification)}>
              <p className="paragraphe-carte secondaire petit">
                Avant de rendre une réponse, un LLM vérifie chaque affirmation contre les passages cités. Une réponse non appuyée repart une fois à
                l'agent&#8239;; si elle ne l'est toujours pas, Rhéa s'abstient. Un appel au LLM de plus par réponse.
              </p>
            </Carte>
          )}
          {c.cache !== undefined && (
            <Carte titre="Cache sémantique" icone="eclair" actions={oui(c.cache.actif)}>
              <Definitions lignes={[["Seuil de similarité", mono(decimal(c.cache.seuil, 2))]]} />
              <p className="paragraphe-carte secondaire petit">
                Une question très proche d'une question du jour, pour le même profil et la même version du prompt, du LLM et de l'index, reçoit la même
                réponse, sans LLM ni recherche. Une réponse personnelle n'y entre jamais.
              </p>
            </Carte>
          )}
        </div>
      )}

      <div className="grille-configuration deux">
        <Carte titre="Prompt système" icone="texte">
          <Definitions lignes={[["Version", <span className="pastilles-ligne">{mono(c.prompt)} <BoutonCopier texte={c.prompt} libelle="Copier la version" /></span>]]} />
        </Carte>
        <Carte titre="Index" icone="base">
          <Definitions
            lignes={[
              ["Passages", nombre(c.index.passages)],
              ["Indexé avec", c.index.modele ? mono(c.index.modele) : "–"],
              ["Stockage", c.index.stockage ? mono(c.index.stockage) : "–"],
            ]}
          />
          {c.index.modele && c.index.modele !== c.embeddings.nom && (
            <p className="note-rendu alerte">
              <Icone nom="alerte" taille={14} /> L'index a été construit avec un autre modèle que celui du projet&nbsp;: relancez npm run indexer -- --reconstruire.
            </p>
          )}
        </Carte>
      </div>

      <Carte titre="Où partent les données" icone="globe" actions={sorties === 0 ? <Pastille ton="ok" icone="machine">tout reste ici</Pastille> : <Pastille ton="alerte" icone="globe">{nombre(sorties)} brique{sorties >= 2 ? "s" : ""} dehors</Pastille>}>
        <p className="muet petit paragraphe-carte">
          Pour chaque brique, la machine qui lit le texte des questions et des passages (chapitre 13). Une seule brique dehors suffit pour que les données
          sortent&#8239;; hors de l'Espace économique européen, c'est un transfert, à encadrer.
        </p>
        <table className="tableau">
          <thead>
            <tr>
              <th scope="col">Brique</th>
              <th scope="col">Où</th>
              <th scope="col">Ici ou dehors</th>
            </tr>
          </thead>
          <tbody>
            {c.destinations.map((d) => (
              <tr key={d.brique}>
                <td className="fort">{d.brique.charAt(0).toLocaleUpperCase("fr") + d.brique.slice(1)}</td>
                <td>{d.ou}</td>
                <td>
                  <PastilleLieu locale={d.locale} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Carte>

      {c.tarifs && (
        <Carte titre="Tarifs" icone="piece" actions={<span className="muet petit">relevés le {formaterDate(c.tarifs.date)}</span>}>
          <p className="muet petit paragraphe-carte">
            En dollars par million de tokens, pour estimer le coût de chaque appel. Source&nbsp;: <span className="mono">{c.tarifs.source}</span>{" "}
            <BoutonCopier texte={c.tarifs.source} libelle="Copier l'adresse de la source" />
          </p>
          <table className="tableau">
            <thead>
              <tr>
                <th scope="col">Modèle</th>
                <th scope="col" className="col-nombre">
                  Entrée
                </th>
                <th scope="col" className="col-nombre">
                  Cache relu
                </th>
                <th scope="col" className="col-nombre">
                  Cache écrit
                </th>
                <th scope="col" className="col-nombre">
                  Sortie
                </th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(c.tarifs.modeles).map(([m, t]) => (
                <tr key={m} className={m === `${c.generation.fournisseur} ${c.generation.modele}` ? "ligne-survolee" : undefined}>
                  <td className="mono">{m}</td>
                  <td className="col-nombre">{decimal(t.entree, 2)}</td>
                  <td className="col-nombre">{decimal(t.enCache, 2)}</td>
                  <td className="col-nombre">{t.ecritureCache === undefined ? "–" : decimal(t.ecritureCache, 2)}</td>
                  <td className="col-nombre">{decimal(t.sortie, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muet petit paragraphe-carte">
            Recherche de fichiers (chapitre 11)&nbsp;: {decimal(c.tarifs.fileSearchPour1000, 2)}&nbsp;$ les 1&nbsp;000 recherches. Un modèle local (Ollama) ne coûte rien par token.
          </p>
        </Carte>
      )}

      {autres.length > 0 && (
        <Carte titre="Autres réglages" icone="json">
          <p className="muet petit paragraphe-carte">Des réglages que cette page ne connaît pas encore, tels que le serveur les envoie.</p>
          {autres.map(([k, v]) => (
            <div key={k} className="autre-reglage">
              <p className="mono fort">{k}</p>
              {estObjet(v) || Array.isArray(v) ? <ArbreJson valeur={v} ouvert={2} /> : <code className="mono">{JSON.stringify(v)}</code>}
            </div>
          ))}
        </Carte>
      )}
    </>
  );
}

function PastilleLieu({ locale }: { locale: boolean | undefined }) {
  if (locale === undefined) return null;
  return locale ? (
    <Pastille ton="ok" icone="machine">
      ici
    </Pastille>
  ) : (
    <Pastille ton="alerte" icone="globe">
      dehors
    </Pastille>
  );
}
