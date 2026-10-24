// Une question d'une évaluation : ce qu'on attendait, ce que Rhéa a répondu, le verdict critère par critère, les passages
// attendus retrouvés ou non, et toute la trace, avec le même pipeline que la conversation
import { useEffect, useMemo, type ReactNode } from "react";
import { useRequete } from "../api/requete.ts";
import { LECONS } from "../api/client.ts";
import { Carte, Definitions, EtatErreur, EtatLecon, EtatVide, Pastille, SqueletteLignes } from "../composants/elements.tsx";
import { Icone } from "../composants/Icone.tsx";
import { PastillePassage } from "../composants/PastillePassage.tsx";
import { TexteRiche } from "../composants/TexteRiche.tsx";
import { configurationDe, useServeur } from "../contextes/serveur.tsx";
import { libelleSalarie, useSession } from "../contextes/session.tsx";
import { cout as formaterCout, date as formaterDate, duree as formaterDuree, nombre, pluriel } from "../outils/format.ts";
import { Pipeline } from "../pipeline/Pipeline.tsx";
import { cheminDeLaQuestion, cheminDeLExecution, Lien, naviguer, useAdresse } from "../routeur.tsx";
import type { DetailExecution, ResultatQuestion } from "../types.ts";
import { CATEGORIES, CRITERES, libelleType, PastilleStatut, statutDe } from "./evaluations/communs.tsx";

const comparerIds = (a: string, b: string) => a.localeCompare(b, "fr", { numeric: true });

export function VueQuestion({ nom, id }: { nom: string; id: string }) {
  const serveur = useServeur();
  const resultat = useRequete<ResultatQuestion>(serveur.inspection ? `/api/evaluations/${encodeURIComponent(nom)}/questions/${encodeURIComponent(id)}` : null);
  const detail = useRequete<DetailExecution>(serveur.inspection ? `/api/evaluations/${encodeURIComponent(nom)}` : null);
  const { parametres } = useAdresse();
  const suite = parametres.toString() ? `?${parametres.toString()}` : "";

  // La question précédente et la suivante, dans l'ordre des identifiants ; [ et ] au clavier
  const ids = useMemo(() => (detail.etat === "ok" ? detail.donnees.questions.map((q) => q.id).sort(comparerIds) : []), [detail]);
  const i = ids.indexOf(id);
  const precedente = i > 0 ? ids[i - 1] : undefined;
  const suivante = i >= 0 && i < ids.length - 1 ? ids[i + 1] : undefined;
  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => {
      const cible = e.target as HTMLElement;
      if (cible.closest("input, textarea, select, [contenteditable]") || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "[" && precedente) naviguer(cheminDeLaQuestion(nom, precedente) + suite);
      if (e.key === "]" && suivante) naviguer(cheminDeLaQuestion(nom, suivante) + suite);
    };
    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, [nom, precedente, suivante, suite]);

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
        <div className="question-navigation">
          <nav className="fil-d-ariane" aria-label="Fil d'Ariane">
            <Lien vers="/evaluations">Évaluations</Lien>
            <Icone nom="chevron-droite" taille={12} />
            <Lien vers={cheminDeLExecution(nom) + suite} className="mono">
              {nom}
            </Lien>
            <Icone nom="chevron-droite" taille={12} />
            <span className="mono">{id}</span>
          </nav>
          <div className="question-precedente-suivante">
            {precedente ? (
              <Lien vers={cheminDeLaQuestion(nom, precedente) + suite} className="bouton bouton-secondaire bouton-petit" title="Question précédente ([)">
                <Icone nom="chevron-gauche" taille={14} /> {precedente}
              </Lien>
            ) : null}
            {i >= 0 && (
              <span className="muet petit">
                {nombre(i + 1)} / {nombre(ids.length)}
              </span>
            )}
            {suivante ? (
              <Lien vers={cheminDeLaQuestion(nom, suivante) + suite} className="bouton bouton-secondaire bouton-petit" title="Question suivante (])">
                {suivante} <Icone nom="chevron-droite" taille={14} />
              </Lien>
            ) : null}
          </div>
        </div>
        {resultat.etat === "chargement" ? (
          <SqueletteLignes lignes={10} libelle="Chargement de la question" />
        ) : resultat.etat === "erreur" ? (
          resultat.erreur.routeAbsente ? (
            <EtatLecon lecon={LECONS.evaluations.lecon} sujet={LECONS.evaluations.sujet} />
          ) : resultat.erreur.statut === 403 ? (
            <div className="note-jeu-cache" role="note">
              <Icone nom="cadenas" taille={18} />
              <div>
                <p className="fort">Jeu caché&nbsp;: on n'en lit que les scores, pour ne jamais régler Rhéa dessus</p>
                <p className="muet">Les questions du jeu caché restent fermées, même dans l'interface d'inspection.</p>
              </div>
            </div>
          ) : resultat.erreur.statut === 404 ? (
            <EtatVide icone="question" titre="Question introuvable" action={<Lien vers={cheminDeLExecution(nom)}>Revenir à l'évaluation</Lien>}>
              L'évaluation <span className="mono">{nom}</span> n'a pas de question <span className="mono">{id}</span>.
            </EtatVide>
          ) : (
            <EtatErreur message={resultat.erreur.message} reessayer={resultat.recharger} />
          )
        ) : (
          <DetailQuestion resultat={resultat.donnees} tarifs={configurationDe(serveur)?.tarifs ?? null} />
        )}
      </div>
    </div>
  );
}

function DetailQuestion({ resultat, tarifs }: { resultat: ResultatQuestion; tarifs: Parameters<typeof Pipeline>[0]["tarifs"] }) {
  const { question: q, obtenu, verdict, trace } = resultat;
  const { salaries } = useSession();
  const salarie = salaries.etat === "ok" ? salaries.donnees.find((s) => s.matricule === q.matricule) : undefined;
  const inventees = useMemo(() => new Set(obtenu.inventees), [obtenu.inventees]);
  const statut = statutDe(verdict.reussie, obtenu.erreur !== undefined);

  return (
    <>
      <header className="entete-question carte">
        <div className="entete-question-ligne">
          <h1 className="mono">{q.id}</h1>
          <PastilleStatut statut={statut} />
          <Pastille>{libelleType(q.type)}</Pastille>
          {(CATEGORIES[q.categorie] ?? q.categorie) !== libelleType(q.type) && <Pastille>{CATEGORIES[q.categorie] ?? q.categorie}</Pastille>}
          <Pastille ton="accent">{q.profil}</Pastille>
        </div>
        <p className="entete-question-texte">{q.question}</p>
        <Definitions
          lignes={[
            ["Salarié", salarie ? <>{libelleSalarie(salarie)} <span className="mono muet">{q.matricule}</span></> : <span className="mono">{q.matricule}</span>],
            ["Date du jour pour Rhéa", formaterDate(q.date)],
            ...(q.enVigueurLe ? ([["La question parle du", formaterDate(q.enVigueurLe)]] as [string, string][]) : []),
            ["Origine", q.origine === "ecrite" ? "écrite" : q.origine === "synthetique" ? "synthétique" : "reprise"],
            ...(q.note ? ([["Note", q.note]] as [string, string][]) : []),
          ]}
        />
      </header>

      {q.historique && (
        <Carte titre="Échanges précédents" icone="conversation">
          <ol className="historique-question">
            {q.historique.map((e, i) => (
              <li key={i}>
                <p className="historique-question-q">{e.question}</p>
                <p className="historique-question-r">{e.reponse}</p>
              </li>
            ))}
          </ol>
        </Carte>
      )}

      <div className="attendu-obtenu">
        <Attendu resultat={resultat} />
        <Carte titre="Ce que Rhéa a répondu" icone="conversation" className="carte-obtenu">
          {obtenu.erreur && (
            <p className="note-rendu alerte">
              <Icone nom="alerte" taille={14} /> La question a échoué&nbsp;: {obtenu.erreur}
            </p>
          )}
          <div className="texte-rendu">
            {obtenu.texte ? <TexteRiche texte={obtenu.texte} sources={{ inventees }} /> : <span className="muet">(aucun texte)</span>}
          </div>
          <Definitions
            lignes={[
              [
                "Sources citées",
                obtenu.citees.length === 0 ? (
                  <span className="muet">aucune</span>
                ) : (
                  <span className="pastilles-ligne">
                    {obtenu.citees.map((p) => (
                      <PastillePassage key={p} id={p} compacte />
                    ))}
                  </span>
                ),
              ],
              ...(obtenu.inventees.length > 0
                ? ([
                    [
                      "Sources inventées",
                      <span className="pastilles-ligne">
                        {obtenu.inventees.map((p) => (
                          <PastillePassage key={p} id={p} inventee compacte />
                        ))}
                      </span>,
                    ],
                  ] as [string, ReactNode][])
                : []),
              [
                "Outils appelés",
                obtenu.outils.length === 0 ? (
                  <span className="muet">aucun</span>
                ) : (
                  <ol className="outils-appeles">
                    {obtenu.outils.map((o, i) => (
                      <li key={i} className="mono">
                        {o}
                      </li>
                    ))}
                  </ol>
                ),
              ],
              ["Tours", nombre(obtenu.tours)],
              ["Tokens", `${nombre(obtenu.usage.entree)} en entrée (dont ${nombre(obtenu.usage.enCache)} en cache) · ${nombre(obtenu.usage.sortie)} en sortie`],
              ["Durée", formaterDuree(obtenu.duree_ms)],
              ["Coût", obtenu.cout === null ? "nul (modèle local)" : formaterCout(obtenu.cout)],
            ]}
          />
        </Carte>
      </div>

      <Carte titre="Verdict, critère par critère" icone="evaluations">
        {verdict.criteres.length === 0 ? (
          <p className="muet">Aucun critère&nbsp;: la question n'a pas été jugée.</p>
        ) : (
          <ul className="criteres">
            {verdict.criteres.map((c) => (
              <li key={c.critere} className={`critere ${c.ok === true ? "ok" : c.ok === false ? "ko" : "inconnu"}`}>
                <span className="critere-icone">
                  <Icone nom={c.ok === true ? "ok" : c.ok === false ? "erreur" : "question"} taille={18} />
                </span>
                <div>
                  <p className="critere-nom">
                    {CRITERES[c.critere] ?? c.critere} <span className="muet">· {c.ok === true ? "satisfait" : c.ok === false ? "non satisfait" : "non jugé"}</span>
                  </p>
                  <p className="critere-raison">{c.raison || "(sans raison)"}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Carte>

      <section className="carte trace-question" aria-labelledby="trace-titre">
        <header className="carte-entete">
          <h2 className="carte-titre" id="trace-titre">
            <Icone nom="eclair" taille={16} /> Toute la trace
          </h2>
          <span className="muet petit">{pluriel(trace.length, "étape")}</span>
        </header>
        <div className="trace-question-corps">
          <Pipeline etapes={trace} tarifs={tarifs} dureeTotale={obtenu.duree_ms} libelle="Étapes de la question" vide={<EtatVide titre="Aucune trace enregistrée" />} />
        </div>
      </section>
    </>
  );
}

function Attendu({ resultat }: { resultat: ResultatQuestion }) {
  const { question: q, obtenu } = resultat;
  const passages = Object.entries(q.passages ?? {}).sort((a, b) => b[1] - a[1] || comparerIds(a[0], b[0]));
  const trouve = (motif: string) => {
    try {
      return new RegExp(motif, "iu").test(obtenu.texte);
    } catch {
      return null;
    }
  };
  const rien = !q.reponse && passages.length === 0 && !q.attendu && !q.interdit;
  return (
    <Carte titre="Ce qu'on attendait" icone="coche" className="carte-attendu">
      {rien && (
        <p className="muet">
          {q.categorie === "hors-corpus"
            ? "Une question hors corpus\u00a0: Rhéa doit dire qu'elle ne sait pas, sans inventer."
            : q.categorie === "interdite"
              ? "Une question interdite\u00a0: Rhéa doit refuser, sans rien laisser paraître."
              : "Aucune attente écrite."}
        </p>
      )}
      {q.reponse && (
        <div className="attendu-bloc">
          <h3>Réponse de référence</h3>
          <div className="texte-rendu">
            <TexteRiche texte={q.reponse} />
          </div>
        </div>
      )}
      {passages.length > 0 && (
        <div className="attendu-bloc">
          <h3>Passages attendus</h3>
          <div className="tableau-defilant">
            <table className="tableau">
              <thead>
                <tr>
                  <th scope="col">Passage</th>
                  <th scope="col">Pertinence</th>
                  <th scope="col">Retrouvé</th>
                  <th scope="col">Cité</th>
                </tr>
              </thead>
              <tbody>
                {passages.map(([id, pertinence]) => {
                  const rang = obtenu.passagesVus.indexOf(id) + 1;
                  const cite = obtenu.citees.includes(id);
                  return (
                    <tr key={id}>
                      <td>
                        <PastillePassage id={id} />
                      </td>
                      <td>{pertinence === 2 ? <Pastille ton="ok">2 · il répond</Pastille> : <Pastille>1 · il aide</Pastille>}</td>
                      <td>{rang > 0 ? <span className="ok-texte">oui, au rang {nombre(rang)}</span> : <span className="ko-texte">non retrouvé</span>}</td>
                      <td>{cite ? <span className="ok-texte">cité</span> : <span className="muet">non</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muet petit">Le rang&nbsp;: la place du passage parmi tous ceux que les outils ont rendus pendant la question, dans l'ordre.</p>
        </div>
      )}
      {q.attendu && (
        <div className="attendu-bloc">
          <h3>Motifs attendus</h3>
          <ul className="motifs">
            {q.attendu.map((m) => {
              const t = trouve(m);
              return (
                <li key={m} className={t ? "ok" : "ko"}>
                  <Icone nom={t ? "coche" : "croix"} taille={14} />
                  <code>{m}</code>
                  <span className="muet petit">{t ? "présent dans la réponse" : "absent de la réponse"}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {q.interdit && (
        <div className="attendu-bloc">
          <h3>Motifs interdits</h3>
          <ul className="motifs">
            {q.interdit.map((m) => {
              const t = trouve(m);
              return (
                <li key={m} className={t ? "ko" : "ok"}>
                  <Icone nom={t ? "alerte" : "coche"} taille={14} />
                  <code>{m}</code>
                  <span className="muet petit">{t ? "trouvé dans la réponse" : "absent, comme il faut"}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {q.documents.length > 0 && (
        <div className="attendu-bloc">
          <h3>Documents de la question</h3>
          <div className="pastilles-ligne">
            {q.documents.map((d) => (
              <Lien key={d} vers={`/index/${encodeURIComponent(d)}`} className="pastille mono">
                {d}
              </Lien>
            ))}
          </div>
        </div>
      )}
    </Carte>
  );
}
