// La réponse de Rhéa dans le fil : l'avancement pendant qu'elle travaille, une demande de confirmation avant une action,
// puis le texte mis en forme, les sources en cartes et une ligne discrète sur ce qu'elle a coûté
import { useEffect, useMemo, useState } from "react";
import { Bouton, Pastille } from "../../composants/elements.tsx";
import { Icone } from "../../composants/Icone.tsx";
import { PastillePassage } from "../../composants/PastillePassage.tsx";
import { TexteRiche } from "../../composants/TexteRiche.tsx";
import { useConversation, type Confirmation, type Echange } from "../../contextes/conversation.tsx";
import { useOuvrirPassage } from "../../contextes/passage.tsx";
import { cout as formaterCout, coutFourchette, duree as formaterDuree, nombre, pluriel, score as formaterScore, secondes } from "../../outils/format.ts";
import { estTerminee, type SourceCitee } from "../../types.ts";
import { estLocal } from "../../pipeline/calculs.ts";

const DELAI_CONFIRMATION_MS = 120_000; // DELAI_CONFIRMATION_MS côté serveur (serveur : api/confirmations.ts)

// Une horloge qui avance chaque seconde tant que la condition tient
function useSecondes(actif: boolean, depuis: number): number {
  const [maintenant, setMaintenant] = useState(() => performance.now());
  useEffect(() => {
    if (!actif) return;
    const minuterie = window.setInterval(() => setMaintenant(performance.now()), 1000);
    return () => window.clearInterval(minuterie);
  }, [actif]);
  return Math.max(0, maintenant - depuis);
}

export function Reponse({ echange }: { echange: Echange }) {
  const { arreter, envoyer, enCours } = useConversation();
  const replis = useMemo(() => new Map((echange.sources?.citees ?? []).map((s) => [s.id, { titre: s.titre, texte: s.texte, score: s.score }])), [echange.sources]);
  const inventees = useMemo(() => new Set(echange.sources?.inventees ?? []), [echange.sources]);
  return (
    <div className="reponse">
      {echange.etat === "en-cours" && !echange.texte && <Avancement echange={echange} onArreter={arreter} />}
      {echange.fin?.degrade && (
        <div className="bandeau-degrade" role="status">
          <Icone nom="alerte" taille={16} />
          <div>
            <p className="fort">Réponse dégradée&nbsp;: aucun LLM disponible</p>
            <p>Rhéa n'a pas pu rédiger de réponse. Voici les passages les plus proches de la question, trouvés sans LLM, à vérifier soi-même.</p>
          </div>
        </div>
      )}
      {echange.confirmations.map((c) => (
        <CarteConfirmation key={c.id} echange={echange.id} confirmation={c} />
      ))}
      {echange.texte && (
        <div className="reponse-texte">
          <TexteRiche texte={echange.texte} sources={{ inventees, replis }} />
        </div>
      )}
      {echange.sources && (echange.sources.citees.length > 0 || echange.sources.inventees.length > 0) && <Sources citees={echange.sources.citees} inventees={echange.sources.inventees} />}
      {echange.etat === "arretee" && (
        <p className="reponse-note">
          <Icone nom="stop" taille={14} /> Réponse arrêtée&nbsp;: le serveur abandonne la suite, et refuse toute action en attente.
        </p>
      )}
      {echange.etat === "erreur" && (
        <div className="reponse-erreur" role="alert">
          <Icone nom="alerte" taille={16} />
          <div>
            <p className="fort">{echange.reessayerApres !== undefined ? "Trop de questions en ce moment" : "Rhéa n'a pas pu répondre"}</p>
            <p>{echange.erreur}</p>
          </div>
          <ReposerLaQuestion apres={echange.reessayerApres} desactive={enCours} onReposer={() => envoyer(echange.question)} />
        </div>
      )}
      {echange.fin && <LigneMeta echange={echange} />}
      {echange.fin?.observation && echange.etat === "terminee" && <AvisDuSalarie echange={echange} />}
    </div>
  );
}

// Reposer la question ; après un 503 (trop de questions), seulement passé le délai que le serveur a donné
function ReposerLaQuestion({ apres, desactive, onReposer }: { apres?: number; desactive: boolean; onReposer: () => void }) {
  const [maintenant, setMaintenant] = useState(() => Date.now());
  const attente = apres !== undefined && apres > maintenant;
  useEffect(() => {
    if (!attente) return;
    const minuterie = window.setInterval(() => setMaintenant(Date.now()), 500);
    return () => window.clearInterval(minuterie);
  }, [attente]);
  return (
    <Bouton petit icone="boucle" onClick={onReposer} disabled={desactive || attente}>
      {attente ? `Réessayer dans ${secondes((apres ?? 0) - maintenant + 999)}` : "Reposer la question"}
    </Bouton>
  );
}

const COMMENTAIRE_MAX = 500; // serveur : 500 caractères au plus

// L'avis du salarié (leçon 7) : pouce levé ou baissé, envoyé tout de suite ; un commentaire facultatif ensuite
function AvisDuSalarie({ echange }: { echange: Echange }) {
  const { donnerAvis } = useConversation();
  const avis = echange.avis;
  const [commentaire, setCommentaire] = useState(avis?.commentaire ?? "");
  const [ecrire, setEcrire] = useState(false);
  const envoi = avis?.etat === "envoi";
  const noter = (note: 1 | -1) => {
    donnerAvis(echange.id, note, avis?.commentaire ?? "");
    if (note === -1 && !avis?.commentaire) setEcrire(true);
  };
  if (avis?.absent) {
    return (
      <p className="avis avis-absent muet petit">
        <Icone nom="horloge" taille={13} /> {avis.erreur}
      </p>
    );
  }
  return (
    <div className="avis" role="group" aria-label="Votre avis sur cette réponse">
      <div className="avis-ligne">
        <span className="avis-question">Cette réponse vous a-t-elle aidé&nbsp;?</span>
        <button type="button" className={`bouton-avis${avis?.note === 1 ? " choisi oui" : ""}`} aria-pressed={avis?.note === 1} aria-label="Oui, utile" title="Oui, utile" disabled={envoi} onClick={() => noter(1)}>
          <Icone nom="pouce" taille={15} />
        </button>
        <button type="button" className={`bouton-avis bas${avis?.note === -1 ? " choisi non" : ""}`} aria-pressed={avis?.note === -1} aria-label="Non, pas utile" title="Non, pas utile" disabled={envoi} onClick={() => noter(-1)}>
          <Icone nom="pouce" taille={15} />
        </button>
        <span className="avis-etat petit" role="status">
          {avis?.etat === "envoi" && <span className="muet">Envoi…</span>}
          {avis?.etat === "ok" && (
            <span className="ok-texte">
              <Icone nom="coche" taille={13} /> Merci{avis.commentaire ? ", commentaire compris" : ""}
            </span>
          )}
          {avis?.etat === "erreur" && <span className="erreur-texte">{avis.erreur}</span>}
        </span>
        {avis && !ecrire && avis.etat !== "envoi" && (
          <button type="button" className="lien-bouton petit" onClick={() => setEcrire(true)}>
            {avis.commentaire ? "Modifier le commentaire" : "Ajouter un commentaire"}
          </button>
        )}
      </div>
      {avis && ecrire && (
        <form
          className="avis-commentaire"
          onSubmit={(e) => {
            e.preventDefault();
            donnerAvis(echange.id, avis.note, commentaire);
            setEcrire(false);
          }}
        >
          <label className="visuellement-cache" htmlFor={`commentaire-${echange.id}`}>
            Commentaire facultatif
          </label>
          <textarea
            id={`commentaire-${echange.id}`}
            rows={2}
            maxLength={COMMENTAIRE_MAX}
            placeholder={avis.note === -1 ? "Qu'est-ce qui manquait, ou n'allait pas\u202f? (facultatif)" : "Un mot de plus\u202f? (facultatif)"}
            value={commentaire}
            onChange={(e) => setCommentaire(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setEcrire(false);
              }
            }}
            autoFocus
          />
          <div className="avis-commentaire-pied">
            <span className={`compteur-champ${commentaire.length >= COMMENTAIRE_MAX ? " plein" : ""}`}>
              {nombre(commentaire.length)} / {nombre(COMMENTAIRE_MAX)}
            </span>
            <Bouton petit variante="fantome" onClick={() => setEcrire(false)}>
              Annuler
            </Bouton>
            <Bouton petit type="submit" variante="primaire" disabled={envoi}>
              Envoyer
            </Bouton>
          </div>
        </form>
      )}
    </div>
  );
}

function Avancement({ echange, onArreter }: { echange: Echange; onArreter: () => void }) {
  const ecoule = useSecondes(true, echange.debutLocal);
  // L'étape en cours la plus récente, et celle qui la contient : « Outil chercher_documents › Vecteur de la requête »
  const enCours = echange.etapes.filter((e) => !estTerminee(e) && e.statut === "en-cours").sort((a, b) => b.debut_ms - a.debut_ms || b.id - a.id);
  const courante = enCours[0];
  const parent = courante?.parent != null ? echange.etapes.find((e) => e.id === courante.parent) : undefined;
  const faites = echange.etapes.filter(estTerminee).length;
  const attente = echange.confirmations.some((c) => c.etat === "attente");
  return (
    <div className="avancement" role="status" aria-live="polite">
      <span className="avancement-indicateur" aria-hidden="true">
        <Icone nom="attente" taille={16} className="tourne" />
      </span>
      <div className="avancement-textes">
        <p className="avancement-titre">{attente ? "Rhéa attend votre accord" : courante ? `${parent ? `${parent.titre} › ` : ""}${courante.titre}…` : "Rhéa lit votre question…"}</p>
        <p className="avancement-detail">
          {secondes(ecoule)} · {pluriel(faites, "étape terminée", "étapes terminées")}
          {attente ? "" : " · le modèle local répond en 10 s à 2 min"}
        </p>
      </div>
      <Bouton petit variante="secondaire" icone="stop" onClick={onArreter}>
        Arrêter
      </Bouton>
    </div>
  );
}

function CarteConfirmation({ echange, confirmation }: { echange: string; confirmation: Confirmation }) {
  const { repondre } = useConversation();
  const attente = confirmation.etat === "attente";
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    if (!attente) return;
    const minuterie = window.setInterval(() => setMaintenant(Date.now()), 1000);
    return () => window.clearInterval(minuterie);
  }, [attente]);
  const reste = Math.max(0, DELAI_CONFIRMATION_MS - (maintenant - confirmation.recue));
  const expiree = attente && reste === 0;
  return (
    <div className={`carte-confirmation etat-${confirmation.etat}`} role={attente ? "alertdialog" : "group"} aria-label="Demande de confirmation">
      <div className="carte-confirmation-entete">
        <Icone nom="cadenas" taille={16} />
        <span className="fort">Rhéa demande votre accord avant d'agir</span>
        {attente && !expiree && <span className="muet petit">refus automatique dans {secondes(reste + 999)}</span>}
      </div>
      <p className="carte-confirmation-action">{confirmation.action}</p>
      {attente || confirmation.etat === "envoi" ? (
        <div className="carte-confirmation-boutons">
          <Bouton variante="primaire" icone="coche" disabled={confirmation.etat === "envoi" || expiree} onClick={() => repondre(echange, confirmation.id, true)}>
            Confirmer
          </Bouton>
          <Bouton icone="croix" disabled={confirmation.etat === "envoi" || expiree} onClick={() => repondre(echange, confirmation.id, false)}>
            Refuser
          </Bouton>
          {expiree && <span className="muet petit">Délai dépassé&nbsp;: le serveur a refusé l'action.</span>}
        </div>
      ) : (
        <p className="carte-confirmation-decision">
          {confirmation.etat === "accordee" && (
            <Pastille ton="ok" icone="coche">
              accord donné
            </Pastille>
          )}
          {confirmation.etat === "refusee" && (
            <Pastille ton="alerte" icone="croix">
              refusée&nbsp;: rien n'a été fait
            </Pastille>
          )}
          {confirmation.etat === "erreur" && (
            <Pastille ton="erreur" icone="alerte">
              {confirmation.erreur ?? "réponse impossible"}
            </Pastille>
          )}
        </p>
      )}
    </div>
  );
}

function Sources({ citees, inventees }: { citees: SourceCitee[]; inventees: string[] }) {
  const ouvrir = useOuvrirPassage();
  return (
    <section className="sources" aria-label="Sources">
      <h3 className="sources-titre">
        Sources <span className="muet">{nombre(citees.length + inventees.length)}</span>
      </h3>
      <ul className="sources-cartes">
        {citees.map((s) => (
          <li key={s.id}>
            <button type="button" className="source-carte" onClick={() => ouvrir(s.id, { titre: s.titre, texte: s.texte, score: s.score })} aria-label={`Ouvrir la source ${s.id}\u00a0: ${s.titre}`}>
              <span className="source-carte-entete">
                <span className="mono source-id">{s.id}</span>
                <span className="source-score" title="Similarité cosinus avec la requête">
                  {formaterScore(s.score)}
                </span>
              </span>
              <span className="source-titre">{s.titre || s.document}</span>
              <span className="source-extrait">{extrait(s.texte)}</span>
            </button>
          </li>
        ))}
        {inventees.map((id) => (
          <li key={id}>
            <div className="source-carte inventee" role="note">
              <span className="source-carte-entete">
                <Icone nom="alerte" taille={14} />
                <PastillePassage id={id} inventee compacte />
              </span>
              <span className="source-titre">Source inventée</span>
              <span className="source-extrait">Rhéa la cite, mais aucun outil ne l'a rendue pendant cette conversation&nbsp;: ne vous y fiez pas.</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// L'extrait d'un passage sur trois lignes : sans les marques de titre et de gras du Markdown
const extrait = (texte: string) =>
  texte
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*|__/g, "")
    .replace(/\s+/g, " ")
    .trim();

function LigneMeta({ echange }: { echange: Echange }) {
  const fin = echange.fin;
  if (!fin) return null;
  const { usage } = fin;
  const local = estLocal(fin.modele.fournisseur);
  const prix = fin.cout ? coutFourchette(fin.cout) : local ? `${formaterCout(0)} (modèle local)` : "coût inconnu";
  // Une réponse du cache, ou dégradée : aucun LLM n'a travaillé, les tokens et le coût ne disent rien
  if (fin.cache !== undefined || fin.degrade) {
    return (
      <p className="ligne-meta">
        <span title="Durée de la réponse, mesurée par le serveur">
          <Icone nom="horloge" taille={12} /> {formaterDuree(fin.duree_ms)}
        </span>
        <span>{fin.cache !== undefined ? "reprise du cache sémantique\u00a0: aucun LLM, aucune recherche" : "aucun LLM disponible\u00a0: passages seuls"}</span>
        <span className="mono" title="Version et empreinte du prompt système">
          prompt {fin.prompt}
        </span>
      </p>
    );
  }
  return (
    <p className="ligne-meta">
      <span title="Durée de la réponse, mesurée par le serveur">
        <Icone nom="horloge" taille={12} /> {formaterDuree(fin.duree_ms)}
      </span>
      <span>{pluriel(fin.tours, "tour")}</span>
      <span title="Tokens d'entrée, dont relus dans le cache, et de sortie, tous tours compris">
        {nombre(usage.entree)} en entrée (dont {nombre(usage.enCache)} en cache) · {nombre(usage.sortie)} en sortie
      </span>
      <span>{prix}</span>
      <span className="mono">
        {fin.modele.fournisseur} {fin.modele.modele}
      </span>
      <span className="mono" title="Version et empreinte du prompt système">
        prompt {fin.prompt}
      </span>
      {echange.historique > 0 && <span title="Les échanges précédents envoyés avec la question">{pluriel(echange.historique, "échange précédent envoyé", "échanges précédents envoyés")}</span>}
    </p>
  );
}
