// Les étapes de la mise en production : la vérification de la réponse (leçon 4), le cache sémantique (leçon 6), le repli
// de fournisseur et la réponse dégradée (leçon 8), et la jauge commune au plancher de similarité et au seuil du cache
import type { ReactNode } from "react";
import { BlocTexte } from "../../composants/BlocTexte.tsx";
import { Pastille } from "../../composants/elements.tsx";
import { Icone } from "../../composants/Icone.tsx";
import { PastillePassage } from "../../composants/PastillePassage.tsx";
import { decimal, pluriel, score as formaterScore } from "../../outils/format.ts";
import { booleen, estIdPassage, estObjet, liste, nombre as lireNombre, objet, passagesBrefs, texte, textes } from "../../outils/lecture.ts";
import { estTerminee, type EtapeTracee, type EtapeVue } from "../../types.ts";
import { estLocal } from "../calculs.ts";
import { Section, TableauPassages, type ProprietesRendu } from "./communs.tsx";

// Une jauge : une valeur (absente quand il n'y en a pas), un repère et son libellé, sur une échelle [min, max]
export function Jauge({ valeur, repere, libelleValeur, libelleRepere, min = 0, max = 1, atteint }: { valeur: number | null; repere: number; libelleValeur: string; libelleRepere: string; min?: number; max?: number; atteint: boolean }) {
  const position = (v: number) => Math.max(0, Math.min(1, (v - min) / (max - min))) * 100;
  // Des graduations rondes : par dixième sur une échelle courte (le cache, de 0,5 à 1), par quart sinon
  const pas = max - min <= 0.5 ? 0.1 : 0.25;
  const graduations = Array.from({ length: Math.round((max - min) / pas) + 1 }, (_, k) => Number((min + k * pas).toFixed(2)));
  return (
    <div className={`jauge-seuil${atteint ? "" : " sous-le-seuil"}`}>
      <div className="jauge-legende">
        <span>
          {libelleValeur} <strong className="mono">{valeur === null ? "–" : formaterScore(valeur)}</strong>
        </span>
        <span className="muet">cosinus{min > 0 ? `, échelle de ${decimal(min, 1)} à ${decimal(max, 0)}` : ", de 0 à 1"}</span>
      </div>
      <div
        className="jauge-piste"
        role="meter"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={valeur ?? min}
        aria-label={`${libelleValeur} ${valeur === null ? "absent" : formaterScore(valeur)}, ${libelleRepere} ${formaterScore(repere)}`}
      >
        {valeur !== null && <span className="jauge-rempli" style={{ width: `${position(valeur)}%` }} />}
        <span className="jauge-repere" style={{ left: `${position(repere)}%` }}>
          <span className="jauge-repere-etiquette">
            {libelleRepere} {decimal(repere, 2)}
          </span>
        </span>
      </div>
      <div className="jauge-graduations" aria-hidden="true">
        {graduations.map((g) => (
          <span key={g} style={{ left: `${position(g)}%` }}>
            {decimal(g, 2)}
          </span>
        ))}
      </div>
    </div>
  );
}

// ok : la décision laisse passer ; false : elle retient (une abstention) ; "bloque" : elle bloque (en rouge) ; "info"
export function Decision({ ok, titre, children }: { ok: boolean | "info" | "bloque"; titre: string; children?: ReactNode }) {
  const classe = ok === "info" ? "decision-info" : ok === "bloque" ? "decision-bloquee" : ok ? "decision-ok" : "decision-abstention";
  return (
    <div className={`decision ${classe}`} role="status">
      <Icone nom={ok === "info" ? "info" : ok === "bloque" ? "erreur" : ok ? "ok" : "interdit"} taille={18} />
      <div>
        <p className="decision-titre">{titre}</p>
        {children && <div className="decision-texte">{children}</div>}
      </div>
    </div>
  );
}

// Le nom lisible d'un outil, quand une preuve est un résultat d'outil et non un passage
const OUTILS: Record<string, string> = {
  consulter_profil: "fiche du salarié",
  consulter_solde: "solde de congés",
  consulter_organigramme: "organigramme",
  interroger_soldes: "statistiques des soldes (SQL)",
  calculer_indemnite_km: "calcul de l'indemnité kilométrique",
  ouvrir_ticket: "ticket ouvert",
  chercher_documents: "recherche documentaire",
};

// Trois états d'une affirmation : établie ; importante et non établie (elle bloque la réponse) ; détail non établi (il
// est seulement signalé). Une exécution d'avant la distinction n'a pas « importante » : toute affirmation non établie y
// bloquait
type EtatAffirmation = "etablie" | "bloquante" | "detail";
const etatDe = (a: { appuyee: boolean; importante?: boolean }): EtatAffirmation => (a.appuyee ? "etablie" : a.importante === false ? "detail" : "bloquante");
const ORDRE: Record<EtatAffirmation, number> = { bloquante: 0, detail: 1, etablie: 2 };

// Les sources citées par la réponse vérifiée : celle du tour du LLM qui précède la vérification
function citeesAvant(etape: EtapeTracee, etapes: EtapeVue[]): Set<string> {
  const tour = etapes
    .filter((e): e is EtapeTracee => estTerminee(e) && e.nom === "tour-llm" && e.id < etape.id)
    .sort((a, b) => b.id - a.id)[0];
  const rendu = tour ? (texte(tour.details, "texte") ?? "") : "";
  return new Set([...rendu.matchAll(/\[([^[\]\s]+#\d+)\]/g)].map((m) => m[1]));
}

// La vérification de la réponse : chaque affirmation, établie ou non par les preuves, son importance et la raison
export function RenduVerification({ etape, contexte }: ProprietesRendu) {
  const affirmations = liste(etape.details, "affirmations")
    .filter(estObjet)
    .map((a) => ({ affirmation: texte(a, "affirmation") ?? "", appuyee: booleen(a, "appuyee") === true, importante: booleen(a, "importante"), raison: texte(a, "raison") ?? "" }));
  const preuves = textes(etape.details, "preuves");
  const relancee = booleen(etape.details, "relancee") === true;
  const citees = citeesAvant(etape, contexte.etapes);
  const comptes = { etablie: 0, bloquante: 0, detail: 0 };
  for (const a of affirmations) comptes[etatDe(a)]++;
  const illisible = affirmations.length === 0 && /illisible/.test(etape.resume);
  const passages = preuves.filter(estIdPassage);
  const outils = preuves.filter((p) => !estIdPassage(p));
  return (
    <>
      <div className="rendu-entete-ligne">
        {relancee ? (
          <Pastille ton="alerte" icone="boucle">
            relancée&nbsp;: deuxième vérification
          </Pastille>
        ) : (
          <Pastille>première vérification</Pastille>
        )}
        {affirmations.length > 0 && (
          <>
            <Pastille ton="ok" icone="coche">
              {pluriel(comptes.etablie, "établie", "établies")}
            </Pastille>
            {comptes.bloquante > 0 && (
              <Pastille ton="erreur" icone="erreur">
                {pluriel(comptes.bloquante, "importante non établie", "importantes non établies")}
              </Pastille>
            )}
            {comptes.detail > 0 && (
              <Pastille ton="alerte" icone="info">
                {pluriel(comptes.detail, "détail non établi", "détails non établis")}
              </Pastille>
            )}
          </>
        )}
      </div>
      {illisible ? (
        <Decision ok="info" titre="Vérificateur illisible">
          Sa réponse n'a pas pu être lue&nbsp;: il n'a rien prouvé, ni dans un sens ni dans l'autre. La réponse est rendue sans vérification.
        </Decision>
      ) : affirmations.length === 0 ? (
        <Decision ok="info" titre="Aucune affirmation à vérifier">
          Un refus ou une abstention&nbsp;: la réponse n'affirme rien que les preuves devraient établir.
        </Decision>
      ) : comptes.bloquante > 0 ? (
        <Decision ok="bloque" titre={`Réponse bloquée : ${pluriel(comptes.bloquante, "affirmation importante non établie", "affirmations importantes non établies")}`}>
          {relancee
            ? "Déjà relancée une fois : plutôt que de rendre une information inventée, Rhéa s'abstient et propose un ticket."
            : "La réponse repart à l'agent, une fois, avec les affirmations en cause : il doit s'en tenir aux preuves, chercher encore, ou dire qu'il ne sait pas."}
          {comptes.detail > 0 ? ` ${pluriel(comptes.detail, "détail non établi est", "détails non établis sont")} seulement signalé${comptes.detail >= 2 ? "s" : ""}.` : ""}
        </Decision>
      ) : comptes.detail > 0 ? (
        <Decision ok="info" titre="Réponse appuyée sur l'essentiel">
          Chaque affirmation importante est établie&nbsp;: la réponse part au salarié. {pluriel(comptes.detail, "détail non établi est", "détails non établis sont")} seulement signalé
          {comptes.detail >= 2 ? "s" : ""}, sans bloquer.
        </Decision>
      ) : (
        <Decision ok titre="Réponse appuyée">
          Chaque affirmation est établie par les passages lus ou par ce qu'ont rendu les outils&nbsp;: la réponse part au salarié.
        </Decision>
      )}
      {affirmations.length > 0 && (
        <Section titre="Affirmations" note="découpées et vérifiées par le LLM vérificateur, contre les seules preuves&#8239;; les non établies d'abord">
          <ol className="affirmations">
            {[...affirmations].sort((a, b) => ORDRE[etatDe(a)] - ORDRE[etatDe(b)]).map((a, i) => {
              const etat = etatDe(a);
              return (
                <li key={i} className={etat}>
                  <span className="affirmation-icone">
                    <Icone nom={etat === "etablie" ? "ok" : etat === "bloquante" ? "erreur" : "info"} taille={16} />
                  </span>
                  <div>
                    <p className="affirmation-texte">«&nbsp;{a.affirmation}&nbsp;»</p>
                    <p className="affirmation-raison">
                      <span className="fort">{etat === "etablie" ? "Établie" : etat === "bloquante" ? "Importante, non établie" : "Détail non établi"}</span>
                      {etat === "etablie" && a.importante === false && <span className="affirmation-etiquette">détail</span>}
                      {etat === "bloquante" && <span className="affirmation-etiquette bloquante">bloquante</span>}
                      {etat === "detail" && <span className="affirmation-etiquette">signalé</span>}
                      {a.raison ? ` : ${a.raison}` : ""}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </Section>
      )}
      <Section titre="Preuves" note="tous les passages lus pendant la question, cités ou non, et les résultats des autres outils">
        {preuves.length === 0 ? (
          <p className="muet rendu-vide">Aucune&nbsp;: ni passage lu, ni résultat d'outil.</p>
        ) : (
          <ul className="preuves">
            {passages.map((p) => (
              <li key={p}>
                <PastillePassage id={p} />
                {citees.has(p) ? <span className="preuve-citee">cité par la réponse</span> : <span className="muet petit">lu, non cité</span>}
              </li>
            ))}
            {outils.map((o) => (
              <li key={o}>
                <Pastille ton="outil" icone="outil" mono>
                  {o}
                </Pastille>
                <span className="muet petit">résultat d'outil{OUTILS[o] ? ` : ${OUTILS[o]}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

// Le cache sémantique : la question la plus proche du jour, sa similarité face au seuil
export function RenduCache({ etape }: ProprietesRendu) {
  const seuil = lireNombre(etape.details, "seuil") ?? 0.92;
  const similarite = lireNombre(etape.details, "similarite") ?? null;
  const sources = textes(etape.details, "sources");
  const trouvee = similarite !== null && similarite >= seuil;
  return (
    <>
      <Jauge valeur={similarite} repere={seuil} libelleValeur="Similarité" libelleRepere="seuil" min={0.5} atteint={trouvee} />
      {trouvee ? (
        <Decision ok titre="Réponse reprise du cache">
          Une question du jour, du même profil, avec la même version (prompt, LLM, reclassement, vérification, modèle d'embedding, index), en est assez proche&nbsp;: sa réponse est rendue telle
          quelle, sans LLM ni recherche.
        </Decision>
      ) : (
        <Decision ok="info" titre="Aucune réponse assez proche">
          Rhéa répond normalement&#8239;; si sa réponse est générique et citée, elle sera gardée pour les questions très proches du jour.
        </Decision>
      )}
      {sources.length > 0 && (
        <Section titre="Sources de la réponse gardée">
          <div className="pastilles-ligne">
            {sources.map((s) => (
              <PastillePassage key={s} id={s} />
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

export function RenduCacheEcrit() {
  return (
    <p className="note-rendu">
      <Icone nom="base" taille={14} /> Réponse générique et citée&nbsp;: gardée pour les questions très proches posées le même jour, par le même profil, avec la
      même version (prompt, LLM, reclassement, vérification, modèle d'embedding, index). Une réponse personnelle (un solde, un nom ou le site de la fiche du salarié) ou une question de suite n'y entre
      jamais.
    </p>
  );
}

function PastilleModele({ modele }: { modele: { fournisseur?: string; modele?: string } | undefined }) {
  if (!modele) return <Pastille>?</Pastille>;
  return (
    <Pastille ton="llm" icone={estLocal(modele.fournisseur) ? "machine" : "globe"} mono>
      {modele.fournisseur} {modele.modele}
    </Pastille>
  );
}

const lireModele = (o: Record<string, unknown> | undefined) => (o ? { fournisseur: texte(o, "fournisseur"), modele: texte(o, "modele") } : undefined);

// Le repli de fournisseur : le principal ne répond pas, le repli prend le relais pour toute la question
export function RenduRepli({ etape }: ProprietesRendu) {
  const raison = texte(etape.details, "raison") ?? "";
  return (
    <>
      <div className="repli">
        <div className="repli-modele indisponible">
          <span className="surtitre">Principal, indisponible</span>
          <PastilleModele modele={lireModele(objet(etape.details, "principal"))} />
        </div>
        <Icone nom="fleche-droite" taille={18} />
        <div className="repli-modele">
          <span className="surtitre">Repli, prend le relais</span>
          <PastilleModele modele={lireModele(objet(etape.details, "repli"))} />
        </div>
      </div>
      <p className="note-rendu">
        <Icone nom="info" taille={14} /> Une fois basculée, la question finit chez le repli&nbsp;: sa conversation a perdu ce que seul le principal savait relire. Le
        disjoncteur du principal se souvient de l'échec pour les questions suivantes.
      </p>
      {raison && (
        <Section titre="Raison">
          <BlocTexte texte={raison} />
        </Section>
      )}
    </>
  );
}

// La réponse dégradée : aucun LLM disponible, les passages les plus proches, trouvés sans LLM
export function RenduDegradation({ etape }: ProprietesRendu) {
  const passages = passagesBrefs(etape.details, "passages");
  const erreur = texte(etape.details, "erreur");
  return (
    <>
      <Decision ok={false} titre="Réponse dégradée&nbsp;: aucun LLM disponible">
        {passages.length > 0
          ? `Plutôt qu'une erreur, ${pluriel(passages.length, "passage le plus proche", "passages les plus proches")}, trouvés sans LLM\u202f; le salarié vérifie qu'ils correspondent à son cas.`
          : "Aucun passage assez proche non plus\u00a0: Rhéa invite le salarié à réessayer plus tard ou à ouvrir un ticket."}
      </Decision>
      {erreur && (
        <Section titre="Ce qui a échoué">
          <BlocTexte texte={erreur} />
        </Section>
      )}
      {passages.length > 0 && (
        <Section titre="Passages rendus">
          <TableauPassages passages={passages} libelleScore="Cosinus" />
        </Section>
      )}
    </>
  );
}
