// La conversation : le fil de discussion au centre, le pipeline de la réponse choisie à droite
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Bouton, BoutonIcone, EtatVide, Pastille, Raccourci } from "../composants/elements.tsx";
import { Icone } from "../composants/Icone.tsx";
import { TOURS_D_HISTORIQUE, useConversation, type Echange } from "../contextes/conversation.tsx";
import { configurationDe, useServeur } from "../contextes/serveur.tsx";
import { nomComplet, nomDuSite, useSession } from "../contextes/session.tsx";
import { decimal, nombre, pluriel } from "../outils/format.ts";
import { Pipeline } from "../pipeline/Pipeline.tsx";
import type { Profil } from "../types.ts";
import { Reponse } from "./conversation/Reponse.tsx";

const QUESTION_MAX = 1000; // la longueur maximale d'une question (serveur : api/serveur.ts)

// Des questions d'exemple selon le profil : de quoi voir chaque chemin de Rhéa (recherche, données, abstention, action)
const EXEMPLES: Record<Profil, { question: string; montre: string }[]> = {
  salarie: [
    { question: "Combien de jours de télétravail ai-je par semaine ?", montre: "recherche hybride, budget" },
    { question: "Quels sont les jours fériés en novembre 2026 ?", montre: "filtres extraits de la question" },
    { question: "Combien de jours de RTT me reste-t-il ?", montre: "données structurées\u00a0: le solde" },
    { question: "Qui est mon manager ?", montre: "organigramme" },
    { question: "Quelle est la météo à Lyon demain ?", montre: "seuil d'abstention" },
    { question: "Mon badge ne fonctionne plus, ouvre un ticket au service RH.", montre: "action à confirmer" },
  ],
  manager: [
    { question: "Combien de jours de congés en reliquat mon équipe a-t-elle au total ?", montre: "données de l'équipe" },
    { question: "Qui, dans mon équipe, a le moins de RTT restants ?", montre: "SQL" },
    { question: "Quel est le barème des primes sur objectifs des managers ?", montre: "document réservé aux managers" },
    { question: "Combien de jours de télétravail ai-je par semaine ?", montre: "recherche hybride" },
  ],
  rh: [
    { question: "Combien de salariés du site de Nantes sont au forfait jours ?", montre: "SQL" },
    { question: "Quelle est la moyenne des RTT restants des salariés de Nantes au forfait jours ?", montre: "SQL" },
    { question: "Quels tickets parlent du télétravail ?", montre: "tickets, règle de deux" },
    { question: "Quel est le barème des primes sur objectifs des managers ?", montre: "document réservé" },
  ],
};

export function VueConversation() {
  const conversation = useConversation();
  const serveur = useServeur();
  const [elargi, setElargi] = useState(false);
  const choisi = conversation.echanges.find((e) => e.id === conversation.selection) ?? conversation.echanges.at(-1);
  return (
    <div className={`vue-conversation${elargi ? " pipeline-elargi" : ""}`}>
      <section className="fil" aria-label="Conversation avec Rhéa">
        <EnTeteDuFil />
        <FilDeDiscussion />
        <Compositeur />
      </section>
      <aside className="panneau-pipeline" aria-label="Pipeline de la réponse">
        <header className="panneau-pipeline-entete">
          <div className="panneau-pipeline-titres">
            <h2>Pipeline</h2>
            {choisi && (
              <p className="panneau-pipeline-question une-ligne" title={choisi.question}>
                {choisi.question}
              </p>
            )}
          </div>
          <BoutonIcone icone={elargi ? "reduire" : "etendre"} libelle={elargi ? "Revenir à la conversation" : "Élargir le pipeline"} onClick={() => setElargi((e) => !e)} />
        </header>
        <div className="panneau-pipeline-corps">
          {!choisi ? (
            <EtatVide icone="eclair" titre="Le pipeline de chaque réponse">
              Posez une question&nbsp;: chaque étape de Rhéa s'affichera ici, en direct, de la recherche à la réponse. Cliquez une étape pour voir tout son
              détail.
            </EtatVide>
          ) : serveur.inspection === false ? (
            <EtatVide icone="cadenas" titre="Inspection désactivée">
              Le serveur tourne sans le mode inspection&nbsp;: il n'envoie pas la trace des réponses. Relancez-le avec INSPECTION=oui pour voir chaque étape.
            </EtatVide>
          ) : (
            <Pipeline
              key={choisi.id}
              etapes={choisi.etapes}
              tarifs={configurationDe(serveur)?.tarifs ?? null}
              enCours={choisi.etat === "en-cours"}
              debutLocal={choisi.debutLocal}
              dureeTotale={choisi.fin?.duree_ms}
              vide={
                choisi.etat === "en-cours" ? (
                  <EtatVide icone="horloge" titre="En attente des premières étapes…" />
                ) : choisi.etat === "erreur" ? (
                  <EtatVide icone="alerte" titre="Aucune étape&nbsp;: la question n'a pas été traitée">
                    {choisi.erreur}
                  </EtatVide>
                ) : (
                  <EtatVide icone="info" titre="Aucune étape reçue">
                    Le serveur n'a envoyé aucune étape pour cette réponse.
                  </EtatVide>
                )
              }
            />
          )}
        </div>
      </aside>
    </div>
  );
}

function EnTeteDuFil() {
  const { echanges, nouvelle, historiqueEnvoye, enCours } = useConversation();
  const { fiche, matricule } = useSession();
  return (
    <header className="fil-entete">
      <div>
        <h1>Conversation</h1>
        <p className="muet petit">
          {fiche ? `${nomComplet(fiche)}, ${fiche.poste}, ${nomDuSite(fiche.site)}` : matricule} ·{" "}
          {echanges.length === 0
            ? `les ${TOURS_D_HISTORIQUE} derniers échanges partent avec chaque question`
            : `${pluriel(historiqueEnvoye, "échange")} d'historique pour la prochaine question (${TOURS_D_HISTORIQUE} au plus)`}
        </p>
      </div>
      <Bouton icone="plus" onClick={nouvelle} disabled={echanges.length === 0 && !enCours}>
        Nouvelle conversation
      </Bouton>
    </header>
  );
}

function FilDeDiscussion() {
  const { echanges, selection, choisir, notice, effacerNotice } = useConversation();
  const fil = useRef<HTMLDivElement>(null);
  const dernier = echanges.at(-1);
  // Le fil descend avec la conversation : une nouvelle question, une réponse qui arrive
  useLayoutEffect(() => {
    const el = fil.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [echanges.length, dernier?.texte, dernier?.confirmations.length, dernier?.etat]);
  // Collé en bas, le fil y reste quand sa taille change (une fenêtre plus étroite, le compositeur qui grandit)
  useEffect(() => {
    const el = fil.current;
    if (!el) return;
    let colle = true;
    const surDefilement = () => {
      colle = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    };
    const observateur = new ResizeObserver(() => {
      if (colle) el.scrollTop = el.scrollHeight;
    });
    el.addEventListener("scroll", surDefilement, { passive: true });
    observateur.observe(el);
    return () => {
      el.removeEventListener("scroll", surDefilement);
      observateur.disconnect();
    };
  }, []);
  const choisi = selection ?? dernier?.id;
  return (
    <div className="fil-messages" ref={fil} role="log" aria-label="Messages" aria-live="polite" aria-relevant="additions">
      {notice && (
        <div className="notice" role="status">
          <Icone nom="info" taille={14} />
          <span>{notice}</span>
          <BoutonIcone icone="croix" libelle="Masquer" taille={14} onClick={effacerNotice} />
        </div>
      )}
      {echanges.length === 0 ? (
        <Accueil />
      ) : (
        echanges.map((e) => <EchangeDuFil key={e.id} echange={e} choisi={e.id === choisi} onChoisir={() => choisir(e.id)} />)
      )}
    </div>
  );
}

function EchangeDuFil({ echange, choisi, onChoisir }: { echange: Echange; choisi: boolean; onChoisir: () => void }) {
  return (
    <article className={`echange${choisi ? " choisi" : ""}`} aria-label={`Question\u00a0: ${echange.question}`}>
      <div className="message-salarie">
        <p>{echange.question}</p>
      </div>
      <div className="message-rhea">
        <div className="message-rhea-entete">
          <span className="avatar-rhea" aria-hidden="true">
            R
          </span>
          <span className="fort">Rhéa</span>
          {echange.fin?.cache !== undefined && (
            <Pastille ton="info" icone="eclair" titre="La réponse vient du cache sémantique&nbsp;: aucun LLM, aucune recherche">
              réponse du cache, similarité {decimal(echange.fin.cache, 2)}
            </Pastille>
          )}
          {echange.fin?.degrade && (
            <Pastille ton="alerte" icone="alerte">
              réponse dégradée
            </Pastille>
          )}
          <button type="button" className={`bouton-pipeline${choisi ? " actif" : ""}`} onClick={onChoisir} aria-pressed={choisi} title="Montrer le pipeline de cette réponse">
            <Icone nom="eclair" taille={13} />
            {choisi ? "Pipeline affiché" : "Voir le pipeline"}
            <span className="muet">{nombre(echange.etapes.length)}</span>
          </button>
        </div>
        <Reponse echange={echange} />
      </div>
    </article>
  );
}

function Accueil() {
  const { envoyer, enCours } = useConversation();
  const { fiche } = useSession();
  const serveur = useServeur();
  const exemples = EXEMPLES[fiche?.role ?? "salarie"];
  const configuration = configurationDe(serveur);
  return (
    <div className="accueil">
      <span className="accueil-logo" aria-hidden="true">
        R
      </span>
      <h2>Bonjour{fiche ? ` ${fiche.prenom}` : ""}, que voulez-vous savoir&nbsp;?</h2>
      <p className="muet">
        Rhéa répond aux questions RH de Kalyo à partir de sa documentation et de vos données, avec les droits du profil {fiche ? <strong>{fiche.role}</strong> : "connecté"}.
        {configuration ? ` Elle tourne avec ${configuration.generation.modele}.` : ""}
      </p>
      <ul className="exemples" aria-label="Questions d'exemple">
        {exemples.map((e) => (
          <li key={e.question}>
            <button type="button" className="exemple" onClick={() => envoyer(e.question)} disabled={enCours}>
              <span className="exemple-question">{e.question}</span>
              <span className="exemple-montre">
                <Icone nom="eclair" taille={12} /> {e.montre}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Compositeur() {
  const { envoyer, enCours, arreter } = useConversation();
  const [question, setQuestion] = useState("");
  const champ = useRef<HTMLTextAreaElement>(null);
  const vide = question.trim().length === 0;

  // La zone grandit avec le texte, jusqu'à huit lignes ; et se remesure quand sa largeur change
  const ajuster = () => {
    const el = champ.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };
  useLayoutEffect(ajuster, [question]);

  useEffect(() => {
    const el = champ.current;
    el?.focus();
    if (!el) return;
    let largeur = el.clientWidth;
    const observateur = new ResizeObserver(() => {
      if (el.clientWidth === largeur) return;
      largeur = el.clientWidth;
      ajuster();
    });
    observateur.observe(el);
    return () => observateur.disconnect();
  }, []);

  const soumettre = (e?: FormEvent) => {
    e?.preventDefault();
    if (vide || enCours) return;
    envoyer(question);
    setQuestion("");
  };

  return (
    <form className="compositeur" onSubmit={soumettre}>
      <label htmlFor="question" className="visuellement-cache">
        Votre question à Rhéa
      </label>
      <textarea
        id="question"
        ref={champ}
        data-champ-principal
        rows={1}
        maxLength={QUESTION_MAX}
        placeholder="Posez une question à Rhéa…"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            soumettre();
          }
        }}
      />
      <div className="compositeur-pied">
        <span className="muet petit compositeur-aide">
          <Raccourci touches={["Ctrl", "Entrée"]} /> pour envoyer
          {question.length > QUESTION_MAX * 0.8 && (
            <span className={question.length >= QUESTION_MAX ? "compteur plein" : "compteur"}>
              {nombre(question.length)} / {nombre(QUESTION_MAX)}
            </span>
          )}
        </span>
        {enCours ? (
          <Bouton variante="secondaire" icone="stop" onClick={arreter}>
            Arrêter
          </Bouton>
        ) : (
          <Bouton type="submit" variante="primaire" icone="envoyer" disabled={vide}>
            Envoyer
          </Bouton>
        )}
      </div>
    </form>
  );
}
