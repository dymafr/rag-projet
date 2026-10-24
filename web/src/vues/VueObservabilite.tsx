// L'observabilité de Rhéa (leçon 7) : une observation par question servie, sans son texte (des références, jamais des
// données), et de quoi suivre le service jour après jour : combien de questions, de réponses sans source, dégradées, en
// erreur, quelle latence, quel coût, quel meilleur score de la recherche, quels avis des salariés ; et la dérive des sept
// derniers jours face aux vingt-huit d'avant
import { useMemo, type ReactNode } from "react";
import { LECONS } from "../api/client.ts";
import { useRequete } from "../api/requete.ts";
import { Bouton, Carte, EtatErreur, EtatLecon, EtatVide, SqueletteLignes } from "../composants/elements.tsx";
import { GraphiqueJours, type Serie } from "../composants/GraphiqueJours.tsx";
import { Icone } from "../composants/Icone.tsx";
import { configurationDe, useServeur } from "../contextes/serveur.tsx";
import { cout as formaterCout, dateCourte, decimal, duree as formaterDuree, nombre, pluriel, pourcentage, score as formaterScore } from "../outils/format.ts";
import { naviguer } from "../routeur.tsx";
import type { Jour, Observations } from "../types.ts";

const JOURS = 30;

// Les trente derniers jours, sans trou : un jour sans question compte zéro (et n'a ni latence ni score)
function joursContinus(jours: Jour[]): Jour[] {
  const parJour = new Map(jours.map((j) => [j.jour, j]));
  const fin = [new Date().toLocaleDateString("sv-SE"), ...jours.map((j) => j.jour)].sort().at(-1) ?? new Date().toLocaleDateString("sv-SE");
  const dernier = new Date(Number(fin.slice(0, 4)), Number(fin.slice(5, 7)) - 1, Number(fin.slice(8, 10)));
  return Array.from({ length: JOURS }, (_, k) => {
    const d = new Date(dernier);
    d.setDate(d.getDate() - (JOURS - 1 - k));
    const jour = d.toLocaleDateString("sv-SE");
    return (
      parJour.get(jour) ?? {
        jour,
        questions: 0,
        sans_source: 0,
        degradees: 0,
        erreurs: 0,
        latence_p50: null,
        latence_p95: null,
        cout: null,
        meilleur_score: null,
        retours_positifs: 0,
        retours_negatifs: 0,
      }
    );
  });
}

const somme = (jours: Jour[], f: (j: Jour) => number) => jours.reduce((s, j) => s + f(j), 0);
const secondes = (ms: number) => (ms >= 1000 ? `${decimal(ms / 1000, ms >= 10_000 ? 0 : 1)} s` : `${nombre(ms)} ms`);

export function VueObservabilite() {
  const serveur = useServeur();
  const lu = useRequete<Observations>(serveur.inspection ? "/api/observations" : null);
  return (
    <div className="vue-page">
      <div className="vue-page-contenu">
        <header className="entete-de-page">
          <div className="entete-de-page-titres">
            <h1>Observabilité</h1>
            <p>
              Une observation par question servie, sans son texte&nbsp;: une empreinte, un pseudonyme, des durées, des tokens, le meilleur score de la recherche.
              De quoi suivre le service jour après jour, et voir une dérive avant les salariés.
            </p>
          </div>
          {lu.etat === "ok" && (
            <Bouton icone="boucle" onClick={lu.recharger}>
              Relire
            </Bouton>
          )}
        </header>
        {serveur.inspection === false ? (
          <EtatVide icone="cadenas" titre="Inspection désactivée">
            Le serveur tourne sans le mode inspection&nbsp;: ses observations ne sont pas lisibles depuis l'interface.
          </EtatVide>
        ) : lu.etat === "chargement" ? (
          <SqueletteLignes lignes={8} libelle="Chargement des observations" />
        ) : lu.etat === "erreur" ? (
          lu.erreur.routeAbsente ? (
            <EtatLecon lecon={LECONS.observabilite.lecon} sujet={LECONS.observabilite.sujet}>
              Garder une trace de chaque question servie (sans son texte), suivre la latence, le coût, les réponses sans source et l'avis des salariés&nbsp;:
              cela arrive avec la leçon 7.
            </EtatLecon>
          ) : (
            <EtatErreur message={lu.erreur.message} reessayer={lu.recharger} />
          )
        ) : lu.donnees.jours.length === 0 ? (
          <EtatVide
            icone="activite"
            titre="Aucune observation pour l'instant"
            action={
              <Bouton variante="primaire" icone="conversation" onClick={() => naviguer("/")}>
                Poser une question à Rhéa
              </Bouton>
            }
          >
            Le serveur n'a encore servi aucune question. Chacune, posée ici ou par POST /ask, laisse une observation&nbsp;: les courbes apparaîtront dès les
            premières.
          </EtatVide>
        ) : (
          <Tableau donnees={lu.donnees} plancher={configurationDe(serveur)?.seuil.plancher ?? undefined} />
        )}
      </div>
    </div>
  );
}

function Tableau({ donnees, plancher }: { donnees: Observations; plancher?: number }) {
  const jours = useMemo(() => joursContinus(donnees.jours), [donnees.jours]);
  const dates = jours.map((j) => j.jour);
  const questions = somme(jours, (j) => j.questions);
  const sansSource = somme(jours, (j) => j.sans_source);
  const degradees = somme(jours, (j) => j.degradees);
  const erreurs = somme(jours, (j) => j.erreurs);
  const positifs = somme(jours, (j) => j.retours_positifs);
  const negatifs = somme(jours, (j) => j.retours_negatifs);
  const couts = jours.filter((j) => j.cout !== null);
  const coutTotal = somme(couts, (j) => j.cout ?? 0);
  const avecScore = jours.filter((j) => j.meilleur_score !== null && j.questions > 0);
  const scoreMoyen = avecScore.length ? somme(avecScore, (j) => (j.meilleur_score ?? 0) * j.questions) / somme(avecScore, (j) => j.questions) : null;
  const dernier = [...jours].reverse().find((j) => j.latence_p95 !== null);

  const seriesQuestions: Serie[] = [
    { cle: "citees", libelle: "citées", couleur: "var(--serie-1)", valeurs: jours.map((j) => Math.max(0, j.questions - j.sans_source - j.degradees - j.erreurs)) },
    { cle: "sans-source", libelle: "sans source", couleur: "var(--serie-neutre)", valeurs: jours.map((j) => j.sans_source) },
    { cle: "degradees", libelle: "dégradées", couleur: "var(--alerte-trait)", valeurs: jours.map((j) => j.degradees) },
    { cle: "erreurs", libelle: "en erreur", couleur: "var(--erreur-trait)", valeurs: jours.map((j) => j.erreurs) },
  ];

  return (
    <>
      <div className="tuiles">
        <Tuile libelle="Questions" valeur={nombre(questions)} detail={`sur ${JOURS} jours`} />
        <Tuile libelle="Sans source" valeur={questions ? pourcentage(sansSource / questions) : "–"} detail={pluriel(sansSource, "réponse", "réponses")} />
        <Tuile libelle="Dégradées" valeur={nombre(degradees)} detail={degradees > 0 ? "aucun LLM disponible" : "aucune"} alerte={degradees > 0} />
        <Tuile libelle="En erreur" valeur={nombre(erreurs)} detail={erreurs > 0 ? "à relire dans le terminal" : "aucune"} alerte={erreurs > 0} />
        <Tuile
          libelle="Latence p95"
          valeur={dernier?.latence_p95 != null ? secondes(dernier.latence_p95) : "–"}
          detail={dernier ? `médiane ${dernier.latence_p50 != null ? secondes(dernier.latence_p50) : "–"}, le ${dateCourte(dernier.jour)}` : "aucune mesure"}
        />
        <Tuile libelle="Coût" valeur={formaterCout(coutTotal)} detail={coutTotal > 0 ? `sur ${JOURS} jours` : "modèles locaux, ou cache"} />
        <Tuile libelle="Meilleur score moyen" valeur={scoreMoyen === null ? "–" : formaterScore(scoreMoyen)} detail="de la recherche, en cosinus" />
        <Tuile libelle="Avis" valeur={`+${nombre(positifs)} / −${nombre(negatifs)}`} detail={positifs + negatifs > 0 ? `${pourcentage(negatifs / (positifs + negatifs))} négatifs` : "aucun avis encore"} />
      </div>

      <PanneauDerive derive={donnees.derive} />

      <div className="grille-graphiques">
        <Carte className="carte-graphique">
          <GraphiqueJours titre="Questions par jour" sousTitre="selon ce que Rhéa a rendu" jours={dates} forme="colonnes" series={seriesQuestions} format={(v) => nombre(v)} entiers />
        </Carte>
        <Carte className="carte-graphique">
          <GraphiqueJours
            titre="Latence"
            sousTitre="médiane et 95ᵉ centile, par jour"
            jours={dates}
            forme="lignes"
            series={[
              { cle: "p50", libelle: "médiane (p50)", couleur: "var(--serie-1)", valeurs: jours.map((j) => j.latence_p50) },
              { cle: "p95", libelle: "95ᵉ centile (p95)", couleur: "var(--serie-2)", valeurs: jours.map((j) => j.latence_p95) },
            ]}
            format={formaterDuree}
            formatAxe={secondes}
          />
        </Carte>
        <Carte className="carte-graphique">
          <GraphiqueJours
            titre="Meilleur score moyen"
            sousTitre="de la recherche&#8239;; une baisse&nbsp;: les questions s'éloignent du corpus"
            jours={dates}
            forme="lignes"
            series={[{ cle: "score", libelle: "meilleur score moyen", couleur: "var(--serie-1)", valeurs: jours.map((j) => (j.questions > 0 ? j.meilleur_score : null)) }]}
            format={formaterScore}
            formatAxe={(v) => decimal(v, 2)}
            domaine={[0, 1]}
            reference={plancher !== undefined ? { valeur: plancher, libelle: `plancher ${decimal(plancher, 2)}` } : undefined}
          />
        </Carte>
        <Carte className="carte-graphique">
          <GraphiqueJours
            titre="Avis des salariés"
            sousTitre="pouce levé au-dessus, pouce baissé en dessous"
            jours={dates}
            forme="divergent"
            series={[
              { cle: "positifs", libelle: "positifs", couleur: "var(--ok-trait)", valeurs: jours.map((j) => j.retours_positifs) },
              { cle: "negatifs", libelle: "négatifs", couleur: "var(--erreur-trait)", valeurs: jours.map((j) => j.retours_negatifs) },
            ]}
            format={(v) => nombre(v)}
            entiers
          />
        </Carte>
        {coutTotal > 0 && (
          <Carte className="carte-graphique">
            <GraphiqueJours titre="Coût par jour" sousTitre="estimé avec les tarifs du serveur" jours={dates} forme="colonnes" series={[{ cle: "cout", libelle: "coût", couleur: "var(--serie-1)", valeurs: jours.map((j) => j.cout) }]} format={formaterCout} />
          </Carte>
        )}
      </div>

      <details className="carte tableau-jours">
        <summary>
          <Icone nom="chevron-droite" taille={12} className="detail-brut-chevron" />
          Les chiffres, jour par jour
        </summary>
        <div className="tableau-defilant">
          <table className="tableau">
            <thead>
              <tr>
                <th scope="col">Jour</th>
                <th scope="col" className="col-nombre">Questions</th>
                <th scope="col" className="col-nombre">Sans source</th>
                <th scope="col" className="col-nombre">Dégradées</th>
                <th scope="col" className="col-nombre">Erreurs</th>
                <th scope="col" className="col-nombre">p50</th>
                <th scope="col" className="col-nombre">p95</th>
                <th scope="col" className="col-nombre">Coût</th>
                <th scope="col" className="col-nombre">Meilleur score</th>
                <th scope="col" className="col-nombre">Avis + / −</th>
              </tr>
            </thead>
            <tbody>
              {[...donnees.jours].reverse().map((j) => (
                <tr key={j.jour}>
                  <td>{dateCourte(j.jour)}</td>
                  <td className="col-nombre">{nombre(j.questions)}</td>
                  <td className="col-nombre">{nombre(j.sans_source)}</td>
                  <td className="col-nombre">{nombre(j.degradees)}</td>
                  <td className="col-nombre">{nombre(j.erreurs)}</td>
                  <td className="col-nombre">{j.latence_p50 === null ? "–" : formaterDuree(j.latence_p50)}</td>
                  <td className="col-nombre">{j.latence_p95 === null ? "–" : formaterDuree(j.latence_p95)}</td>
                  <td className="col-nombre">{j.cout === null ? "–" : formaterCout(j.cout)}</td>
                  <td className="col-nombre">{j.meilleur_score === null ? "–" : formaterScore(j.meilleur_score)}</td>
                  <td className="col-nombre">
                    +{nombre(j.retours_positifs)} / −{nombre(j.retours_negatifs)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

function Tuile({ libelle, valeur, detail, alerte }: { libelle: string; valeur: string; detail: string; alerte?: boolean }) {
  return (
    <div className={`tuile${alerte ? " alerte" : ""}`}>
      <span className="tuile-libelle">{libelle}</span>
      <span className="tuile-valeur">{valeur}</span>
      <span className="tuile-detail">{detail}</span>
    </div>
  );
}

// La dérive : les 7 derniers jours face aux 28 d'avant, et les alertes du serveur
function PanneauDerive({ derive }: { derive: Observations["derive"] }) {
  const { recents, avant, alertes } = derive;
  const part = (v: number | null) => (v === null ? "–" : pourcentage(v, 1));
  const score = (v: number | null) => (v === null ? "–" : formaterScore(v));
  // L'écart, et s'il va dans le mauvais sens (monter est mauvais pour les réponses sans source et les avis négatifs)
  const ecart = (r: number | null, a: number | null, format: (v: number) => string, hausseMauvaise: boolean): ReactNode => {
    if (r === null || a === null) return <span className="muet">–</span>;
    const d = r - a;
    if (Math.abs(d) < 1e-9) return <span className="muet">=</span>;
    const mauvais = d > 0 === hausseMauvaise;
    return (
      <span className={`ecart ${mauvais ? "mauvais" : "bon"}`}>
        <Icone nom={d > 0 ? "fleche-haut" : "fleche-bas"} taille={12} />
        {format(Math.abs(d))}
      </span>
    );
  };
  const lignes: [string, string, string, ReactNode][] = [
    ["Questions", nombre(recents.questions), nombre(avant.questions), <span className="muet">–</span>],
    ["Part sans source", part(recents.sansSource), part(avant.sansSource), ecart(recents.sansSource, avant.sansSource, (v) => `${decimal(v * 100, 1)} pt`, true)],
    ["Meilleur score moyen", score(recents.meilleurScore), score(avant.meilleurScore), ecart(recents.meilleurScore, avant.meilleurScore, (v) => formaterScore(v), false)],
    ["Part des avis négatifs", part(recents.negatifs), part(avant.negatifs), ecart(recents.negatifs, avant.negatifs, (v) => `${decimal(v * 100, 1)} pt`, true)],
  ];
  return (
    <Carte titre="Dérive" icone="activite" className="carte-derive" actions={<span className="muet petit">7 derniers jours, face aux 28 d'avant</span>}>
      <div className="derive">
        <table className="tableau tableau-derive">
          <thead>
            <tr>
              <th scope="col">Indicateur</th>
              <th scope="col" className="col-nombre">7 derniers jours</th>
              <th scope="col" className="col-nombre">28 jours d'avant</th>
              <th scope="col" className="col-nombre">Écart</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map(([libelle, r, a, e]) => (
              <tr key={libelle}>
                <th scope="row">{libelle}</th>
                <td className="col-nombre">{r}</td>
                <td className="col-nombre muet">{a}</td>
                <td className="col-nombre">{e}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="derive-alertes">
          {alertes.length === 0 ? (
            <div className="decision decision-ok" role="status">
              <Icone nom="ok" taille={18} />
              <div>
                <p className="decision-titre">Aucune alerte</p>
                <p className="decision-texte">{avant.questions === 0 ? "Pas encore d'historique à comparer\u00a0: il faut des questions sur plus d'une semaine." : "Rien ne dérive au-delà des seuils du serveur."}</p>
              </div>
            </div>
          ) : (
            <div className="decision decision-abstention" role="alert">
              <Icone nom="alerte" taille={18} />
              <div>
                <p className="decision-titre">{pluriel(alertes.length, "alerte")}</p>
                <ul className="derive-liste">
                  {alertes.map((a) => (
                    <li key={a}>{a.charAt(0).toLocaleUpperCase("fr") + a.slice(1)}.</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          <p className="muet petit">Une alerte dit où regarder, pas quoi corriger&nbsp;: relisez des questions récentes avec l'inspection.</p>
        </div>
      </div>
    </Carte>
  );
}
