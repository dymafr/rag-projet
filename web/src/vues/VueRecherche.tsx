// La recherche seule (POST /api/rechercher) : une question et une date, les passages que rendrait l'outil
// chercher_documents, et toute la trace de la recherche, sans attendre le LLM qui rédige
import { useEffect, useRef, useState, type FormEvent } from "react";
import { appeler, ErreurApi, estAbandon } from "../api/client.ts";
import { BarreScore, Bouton, EtatErreur, EtatVide, Raccourci, SqueletteLignes } from "../composants/elements.tsx";
import { PastillePassage } from "../composants/PastillePassage.tsx";
import { configurationDe, useServeur } from "../contextes/serveur.tsx";
import { useSession } from "../contextes/session.tsx";
import { aujourdhui, date as formaterDate, duree as formaterDuree, pluriel, score as formaterScore } from "../outils/format.ts";
import { Pipeline } from "../pipeline/Pipeline.tsx";
import type { Recherche } from "../types.ts";

type Etat =
  | { etat: "repos" }
  | { etat: "chargement"; question: string; date: string }
  | { etat: "ok"; question: string; date: string; resultat: Recherche; duree: number }
  | { etat: "erreur"; message: string };

const EXEMPLES = [
  "Je peux télétravailler depuis le Portugal cet été ?",
  "Quels sont les jours fériés en novembre 2026 ?",
  "Quel est le plafond pour un repas avec un client à Paris ?",
  "Quelle est la météo à Lyon demain ?",
];

export function VueRecherche() {
  const serveur = useServeur();
  const { matricule, fiche } = useSession();
  const [question, setQuestion] = useState("");
  const [jour, setJour] = useState(aujourdhui);
  const [etat, setEtat] = useState<Etat>({ etat: "repos" });
  const annulation = useRef<AbortController | null>(null);

  // Un autre salarié : le résultat précédent disparaît (il venait des droits d'un autre profil)
  useEffect(() => {
    annulation.current?.abort();
    setEtat({ etat: "repos" });
  }, [matricule]);
  useEffect(() => () => annulation.current?.abort(), []);

  const chercher = async (q: string) => {
    const texte = q.trim();
    if (!texte) return;
    annulation.current?.abort();
    const controleur = new AbortController();
    annulation.current = controleur;
    setEtat({ etat: "chargement", question: texte, date: jour });
    const debut = performance.now();
    try {
      const resultat = await appeler<Recherche>("/api/rechercher", { matricule, corps: { question: texte, ...(jour && { date: jour }) }, signal: controleur.signal });
      setEtat({ etat: "ok", question: texte, date: jour, resultat, duree: performance.now() - debut });
    } catch (erreur) {
      if (estAbandon(erreur)) return;
      setEtat({ etat: "erreur", message: erreur instanceof ErreurApi ? erreur.message : String(erreur) });
    }
  };

  const soumettre = (e: FormEvent) => {
    e.preventDefault();
    void chercher(question);
  };

  return (
    <div className="vue-page vue-recherche">
      <div className="vue-page-contenu large">
        <header className="entete-de-page">
          <div className="entete-de-page-titres">
            <h1>Recherche</h1>
            <p>
              La recherche seule, comme la lance l'outil chercher_documents, avec les droits du salarié connecté{fiche ? ` (profil ${fiche.role})` : ""}&nbsp;: de
              quoi comprendre un classement sans attendre le LLM qui rédige. Les filtres extraits appellent quand même le LLM si la question contient un
              indice de date ou de type de document.
            </p>
          </div>
        </header>

        <form className="formulaire-recherche carte" onSubmit={soumettre}>
          <label className="champ champ-question">
            <span className="champ-libelle">Question</span>
            <input
              data-champ-principal
              value={question}
              maxLength={1000}
              placeholder="Combien de jours de télétravail ai-je par semaine&#8239;?"
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void chercher(question);
                }
              }}
            />
          </label>
          <label className="champ champ-date">
            <span className="champ-libelle">Date du jour pour Rhéa</span>
            <input type="date" value={jour} onChange={(e) => setJour(e.target.value)} />
          </label>
          <div className="formulaire-recherche-actions">
            <Bouton type="submit" variante="primaire" icone="recherche" disabled={!question.trim() || serveur.inspection === false || etat.etat === "chargement"}>
              Rechercher
            </Bouton>
            <Raccourci touches={["Entrée"]} />
          </div>
          <div className="exemples-ligne">
            <span className="muet petit">Essayer&nbsp;:</span>
            {EXEMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                className="puce-exemple"
                onClick={() => {
                  setQuestion(ex);
                  void chercher(ex);
                }}
                disabled={serveur.inspection === false}
              >
                {ex}
              </button>
            ))}
          </div>
        </form>

        {serveur.inspection === false ? (
          <EtatVide icone="cadenas" titre="Inspection désactivée">
            Le serveur tourne sans le mode inspection&nbsp;: la recherche seule n'existe pas. On peut toujours discuter avec Rhéa.
          </EtatVide>
        ) : etat.etat === "repos" ? (
          <EtatVide icone="recherche" titre="Une question, et la recherche seule">
            Les passages rendus s'afficheront ici, avec la trace&nbsp;: droits du lecteur, filtres, vecteur de la requête, recherches vectorielle et plein
            texte, fusion des rangs.
          </EtatVide>
        ) : etat.etat === "erreur" ? (
          <EtatErreur titre="La recherche a échoué" message={etat.message} reessayer={() => void chercher(question)} />
        ) : (
          <div className="resultats-recherche">
            <section className="carte resultats-passages" aria-label="Passages rendus" aria-busy={etat.etat === "chargement"}>
              <header className="carte-entete">
                <h2 className="carte-titre">Passages rendus</h2>
                {etat.etat === "ok" && (
                  <span className="muet petit">
                    {pluriel(etat.resultat.passages.length, "passage")} · {formaterDuree(etat.duree)} · en vigueur le {formaterDate(etat.date)}
                  </span>
                )}
              </header>
              {etat.etat === "chargement" ? (
                <SqueletteLignes lignes={6} libelle="Recherche en cours" />
              ) : etat.resultat.passages.length === 0 ? (
                <EtatVide icone="interdit" titre="Aucun passage">
                  Aucun passage lisible par ce profil ne correspond, à cette date.
                </EtatVide>
              ) : (
                <ol className="liste-passages-rendus">
                  {etat.resultat.passages.map((p, i) => (
                    <PassageRendu key={p.id} rang={i + 1} passage={p} seuil={configurationDe(serveur)?.seuil.valeur} />
                  ))}
                </ol>
              )}
            </section>
            <section className="carte resultats-trace" aria-label="Trace de la recherche">
              {etat.etat === "chargement" ? (
                <SqueletteLignes lignes={9} libelle="Trace en cours" />
              ) : (
                <Pipeline etapes={etat.resultat.trace} tarifs={configurationDe(serveur)?.tarifs ?? null} libelle="Étapes de la recherche" />
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

// L'aperçu sur trois lignes : sans les marques de titre et de gras du Markdown ; le texte entier, tel quel, une fois déplié
const apercu = (texte: string) =>
  texte
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*|__/g, "")
    .replace(/\s+/g, " ")
    .trim();

function PassageRendu({ rang, passage, seuil }: { rang: number; passage: Recherche["passages"][number]; seuil?: number }) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <li className="passage-rendu">
      <span className="passage-rendu-rang">{rang}</span>
      <div className="passage-rendu-corps">
        <div className="passage-rendu-entete">
          <PastillePassage id={passage.id} repli={{ titre: passage.titre, texte: passage.texte, score: passage.score }} />
          <span className="passage-rendu-score">
            <BarreScore
              rapport={passage.score}
              valeur={formaterScore(passage.score)}
              ton={seuil !== undefined && passage.score < seuil ? "decision" : "recherche"}
              libelle={`Cosinus de ${passage.id}`}
            />
          </span>
        </div>
        {passage.titre && <p className="passage-rendu-titre">{passage.titre}</p>}
        <p className={`passage-rendu-texte${ouvert ? " ouvert" : ""}`}>{ouvert ? passage.texte : apercu(passage.texte)}</p>
        <button type="button" className="lien-bouton petit" onClick={() => setOuvert((o) => !o)} aria-expanded={ouvert}>
          {ouvert ? "Replier" : "Lire tout le passage"}
        </button>
      </div>
    </li>
  );
}
