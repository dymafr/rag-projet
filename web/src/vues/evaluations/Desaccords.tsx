// Les désaccords entre deux juges (leçon 4) : deux exécutions qui ont jugé les mêmes réponses de Rhéa, chacune avec son
// juge. Pour chaque désaccord, la question, la réponse, les raisons de chaque juge, et la décision humaine : réussie ou
// échouée, avec une raison. Ces étiquettes mesurent ensuite chaque juge (combien de réponses justes il reconnaît, combien
// de fausses il attrape)
import { useState } from "react";
import { appeler, ErreurApi, LECONS } from "../../api/client.ts";
import { useRequete } from "../../api/requete.ts";
import { Bouton, Carte, EtatErreur, EtatLecon, EtatVide, Pastille, SqueletteLignes } from "../../composants/elements.tsx";
import { Icone } from "../../composants/Icone.tsx";
import { TexteRiche } from "../../composants/TexteRiche.tsx";
import { date as formaterDate, nombre, pluriel } from "../../outils/format.ts";
import { cheminDeLaQuestion, Lien } from "../../routeur.tsx";
import type { Desaccord, Desaccords as DonneesDesaccords, Etiquette } from "../../types.ts";
import { CRITERES } from "./communs.tsx";

const RAISON_MAX = 500; // serveur : 500 caractères au plus

export function Desaccords({ a, b }: { a: string; b: string }) {
  const lu = useRequete<DonneesDesaccords>(`/api/desaccords?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
  const [ajoutees, setAjoutees] = useState<Etiquette[]>([]);
  const etiquettes = lu.etat === "ok" ? [...ajoutees, ...lu.donnees.etiquettes] : ajoutees;
  const etiquetteDe = (d: Desaccord) => etiquettes.find((e) => e.id === d.id && e.reponse === d.empreinte);

  return (
    <section className="desaccords" aria-labelledby="desaccords-titre">
      <header className="desaccords-entete">
        <div>
          <h2 id="desaccords-titre">Désaccords entre les deux juges</h2>
          <p className="muet petit">
            Les questions où A et B ont jugé la même réponse de Rhéa différemment. Un humain tranche&nbsp;: ses étiquettes mesurent ensuite chaque juge.
          </p>
        </div>
        {lu.etat === "ok" && lu.donnees.desaccords.length > 0 && (
          <span className="muet petit">
            {pluriel(lu.donnees.desaccords.length, "désaccord")}, {nombre(lu.donnees.desaccords.filter((d) => etiquetteDe(d)).length)} tranché
            {lu.donnees.desaccords.filter((d) => etiquetteDe(d)).length >= 2 ? "s" : ""}
          </span>
        )}
      </header>
      {lu.etat === "chargement" ? (
        <SqueletteLignes lignes={4} libelle="Chargement des désaccords" />
      ) : lu.etat === "erreur" ? (
        lu.erreur.routeAbsente ? (
          <EtatLecon lecon={LECONS.desaccords.lecon} sujet={LECONS.desaccords.sujet}>
            Faire juger les mêmes réponses par deux juges, et trancher leurs désaccords&nbsp;: cela arrive avec la leçon 4.
          </EtatLecon>
        ) : lu.erreur.statut === 404 ? (
          <EtatVide icone="cadenas" titre="Pas de désaccords pour ces deux exécutions">
            L'une des deux est introuvable, ou du jeu caché&nbsp;: on n'en lit que les scores.
          </EtatVide>
        ) : (
          <EtatErreur message={lu.erreur.message} reessayer={lu.recharger} />
        )
      ) : lu.donnees.desaccords.length === 0 ? (
        <EtatVide icone="comparer" titre="Aucun désaccord">
          Les juges ne se contredisent que sur une même réponse&nbsp;: comparez deux exécutions qui ont jugé les mêmes réponses de Rhéa avec deux juges
          différents.
        </EtatVide>
      ) : (
        <ul className="liste-desaccords">
          {lu.donnees.desaccords.map((d) => (
            <li key={d.id}>
              <CarteDesaccord desaccord={d} a={a} etiquette={etiquetteDe(d)} onEtiquete={(e) => setAjoutees((liste) => [e, ...liste])} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Verdict({ juge, reussie }: { juge: string; reussie: boolean | null }) {
  return reussie === true ? (
    <Pastille ton="ok" icone="coche">
      {juge}&nbsp;: réussie
    </Pastille>
  ) : reussie === false ? (
    <Pastille ton="erreur" icone="croix">
      {juge}&nbsp;: échouée
    </Pastille>
  ) : (
    <Pastille>{juge}&nbsp;: non jugée</Pastille>
  );
}

// « exactitude : la réponse dit 2 jours » → le critère en libellé, puis la raison
function Raisons({ raisons }: { raisons: string[] }) {
  if (raisons.length === 0) return <p className="muet petit">Aucune réserve&nbsp;: ce juge la dit réussie.</p>;
  return (
    <ul className="raisons-juge">
      {raisons.map((r, i) => {
        // « fidelite : la raison » : le critère du serveur, puis la raison
        const m = /^([\w-]+) : ([\s\S]*)$/.exec(r);
        const libelle = m ? CRITERES[m[1]] : undefined;
        return (
          <li key={i}>
            {m && libelle ? (
              <>
                <span className="fort">{libelle}</span>&nbsp;: {m[2]}
              </>
            ) : (
              r
            )}
          </li>
        );
      })}
    </ul>
  );
}

function CarteDesaccord({ desaccord: d, a, etiquette, onEtiquete }: { desaccord: Desaccord; a: string; etiquette?: Etiquette; onEtiquete: (e: Etiquette) => void }) {
  const [modifier, setModifier] = useState(false);
  return (
    <Carte className={`carte-desaccord${etiquette && !modifier ? " tranchee" : ""}`}>
      <div className="desaccord-entete">
        <Lien vers={cheminDeLaQuestion(a, d.id)} className="mono fort">
          {d.id}
        </Lien>
        <p className="desaccord-question">{d.question}</p>
        <span className="pastilles-ligne">
          <Verdict juge="Juge A" reussie={d.a} />
          <Verdict juge="Juge B" reussie={d.b} />
        </span>
      </div>
      <div className="desaccord-reponse">
        <p className="surtitre">Réponse de Rhéa</p>
        <div className="texte-rendu">
          <TexteRiche texte={d.reponse} />
        </div>
      </div>
      <div className="desaccord-juges">
        <div>
          <p className="surtitre">Raisons du juge A</p>
          <Raisons raisons={d.raisonsA} />
        </div>
        <div>
          <p className="surtitre">Raisons du juge B</p>
          <Raisons raisons={d.raisonsB} />
        </div>
      </div>
      {etiquette && !modifier ? (
        <div className={`etiquette-posee ${etiquette.reussie ? "ok" : "ko"}`} role="status">
          <Icone nom={etiquette.reussie ? "ok" : "erreur"} taille={18} />
          <div>
            <p className="fort">
              Tranché&nbsp;: {etiquette.reussie ? "réussie" : "échouée"} <span className="muet petit">· le {formaterDate(etiquette.date)}</span>
            </p>
            <p className="petit">{etiquette.raison}</p>
          </div>
          <Bouton petit variante="fantome" onClick={() => setModifier(true)}>
            Changer
          </Bouton>
        </div>
      ) : (
        <FormulaireEtiquette
          a={a}
          id={d.id}
          empreinte={d.empreinte}
          initiale={etiquette}
          onAnnuler={etiquette ? () => setModifier(false) : undefined}
          onEtiquete={(e) => {
            onEtiquete(e);
            setModifier(false);
          }}
        />
      )}
    </Carte>
  );
}

function FormulaireEtiquette({ a, id, empreinte, initiale, onAnnuler, onEtiquete }: { a: string; id: string; empreinte: string; initiale?: Etiquette; onAnnuler?: () => void; onEtiquete: (e: Etiquette) => void }) {
  const [reussie, setReussie] = useState<boolean | null>(initiale?.reussie ?? null);
  const [raison, setRaison] = useState(initiale?.raison ?? "");
  const [etat, setEtat] = useState<{ envoi: boolean; erreur?: string }>({ envoi: false });
  const valide = reussie !== null && raison.trim().length > 0;
  const envoyer = async () => {
    const decision = reussie;
    if (decision === null || !raison.trim()) return;
    setEtat({ envoi: true });
    try {
      await appeler<{ ok: true }>("/api/etiquettes", { corps: { execution: a, id, reussie: decision, raison: raison.trim() } });
      onEtiquete({ id, reponse: empreinte, reussie: decision, raison: raison.trim(), date: new Date().toLocaleDateString("sv-SE") });
      setEtat({ envoi: false });
    } catch (erreur) {
      setEtat({ envoi: false, erreur: erreur instanceof ErreurApi ? erreur.message : String(erreur) });
    }
  };
  return (
    <form
      className="formulaire-etiquette"
      onSubmit={(e) => {
        e.preventDefault();
        void envoyer();
      }}
    >
      <fieldset className="choix-verdict">
        <legend className="surtitre">Votre décision</legend>
        <label className={`choix ${reussie === true ? "actif ok" : ""}`}>
          <input type="radio" name={`verdict-${id}`} checked={reussie === true} onChange={() => setReussie(true)} />
          <Icone nom="coche" taille={14} /> Réussie
        </label>
        <label className={`choix ${reussie === false ? "actif ko" : ""}`}>
          <input type="radio" name={`verdict-${id}`} checked={reussie === false} onChange={() => setReussie(false)} />
          <Icone nom="croix" taille={14} /> Échouée
        </label>
      </fieldset>
      <label className="champ">
        <span className="champ-libelle">
          Raison <span className="muet">(obligatoire)</span>
        </span>
        <textarea rows={2} maxLength={RAISON_MAX} value={raison} onChange={(e) => setRaison(e.target.value)} placeholder="Ce que dit le passage, ce qui manque ou ce qui est faux…" />
        <span className={`compteur-champ${raison.length >= RAISON_MAX ? " plein" : ""}`}>
          {nombre(raison.length)} / {nombre(RAISON_MAX)}
        </span>
      </label>
      <div className="formulaire-etiquette-actions">
        {etat.erreur && (
          <span className="erreur-texte" role="alert">
            {etat.erreur}
          </span>
        )}
        {onAnnuler && (
          <Bouton petit variante="fantome" onClick={onAnnuler}>
            Annuler
          </Bouton>
        )}
        <Bouton petit type="submit" variante="primaire" icone="coche" disabled={!valide || etat.envoi}>
          {etat.envoi ? "Enregistrement…" : "Enregistrer l'étiquette"}
        </Bouton>
      </div>
    </form>
  );
}

