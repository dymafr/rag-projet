// Les décisions : les droits du lecteur, les filtres extraits de la question, le seuil d'abstention, le budget de
// passages, la limite de l'agent, les sources citées
import { Definitions, Pastille } from "../../composants/elements.tsx";
import { Icone } from "../../composants/Icone.tsx";
import { PastilleAcces } from "../../composants/PastilleAcces.tsx";
import { PastillePassage } from "../../composants/PastillePassage.tsx";
import { date, nombre, pluriel, pourcentage, score as formaterScore, tokens as formaterTokens } from "../../outils/format.ts";
import { booleen, estObjet, liste, nombre as lireNombre, objet, passageBref, passagesBrefs, texte, textes } from "../../outils/lecture.ts";
import { Filtres, Section, TableauPassages, type ProprietesRendu } from "./communs.tsx";
import { Decision, Jauge } from "./production.tsx";

export function RenduDroits({ etape }: ProprietesRendu) {
  const niveaux = textes(etape.details, "niveaux");
  const enVigueurLe = texte(etape.details, "enVigueurLe");
  return (
    <>
      <Definitions
        lignes={[
          ["Profil", <Pastille ton="accent">{texte(etape.details, "profil") ?? "–"}</Pastille>],
          [
            "Niveaux d'accès lisibles",
            <span className="pastilles-ligne">
              {niveaux.map((n) => (
                <PastilleAcces key={n} acces={n} />
              ))}
            </span>,
          ],
          ["Date d'effet", enVigueurLe ? `textes en vigueur le ${date(enVigueurLe)}` : "–"],
          ["Requête", texte(etape.details, "requete") ?? "–"],
        ]}
      />
      <p className="note-rendu">
        <Icone nom="bouclier" taille={14} /> La trace dit ce que la recherche a le droit de lire, jamais ce que ce filtre écarte&nbsp;: le nombre de
        passages écartés suffirait à révéler qu'un document réservé existe (chapitre 13).
      </p>
    </>
  );
}

export function RenduFiltresExtraits({ etape, contexte }: ProprietesRendu) {
  const extraits = objet(etape.details, "extraits") ?? {};
  const vides = Object.keys(extraits).length === 0;
  const appelLlm = contexte.etapes.some((e) => e.parent === etape.id && e.nom === "appel-llm");
  return (
    <>
      <Section titre="Filtres appliqués à la recherche">
        {vides ? <p className="muet rendu-vide">Aucun filtre&nbsp;: la recherche garde la date du jour et tous les types de document.</p> : <Filtres filtres={extraits} />}
      </Section>
      <p className="note-rendu">
        <Icone nom="info" taille={14} />
        {appelLlm
          ? " La question contient un indice (une année, un mois, un type de document)\u00a0: le LLM a été appelé pour l'extraire\u202f; son appel est l'étape imbriquée."
          : " Sans indice de date ni de type de document dans la question, le LLM n'est pas appelé."}{" "}
        Un filtre extrait ne touche jamais au niveau d'accès.
      </p>
    </>
  );
}

export function RenduFiltresEcartes() {
  return (
    <p className="note-rendu alerte">
      <Icone nom="filtre-barre" taille={14} /> Avec les filtres extraits, aucune recherche n'a trouvé de passage&nbsp;: un filtre extrait à tort peut tout
      écarter. La recherche a été relancée sans eux, avec la seule date du jour et les droits du lecteur.
    </p>
  );
}

// Le seuil d'abstention, devenu plancher de similarité (leçon 4) : la jauge suit le titre de l'étape (« Plancher de
// similarité », « Seuil d'abstention ») ; details.seuil est le repère, quel que soit son nom
export function RenduSeuil({ etape }: ProprietesRendu) {
  const meilleur = lireNombre(etape.details, "meilleur") ?? 0;
  const repere = lireNombre(etape.details, "seuil") ?? 0;
  const horsCorpus = booleen(etape.details, "horsCorpus") === true;
  const nom = etape.titre.split(/\s+/)[0].toLocaleLowerCase("fr") || "seuil"; // plancher, seuil
  const ecart = Math.abs(meilleur - repere);
  return (
    <>
      <Jauge valeur={meilleur} repere={repere} libelleValeur="Meilleur score" libelleRepere={nom} atteint={!horsCorpus} />
      <Decision ok={!horsCorpus} titre={horsCorpus ? "Aucun passage rendu" : "Passages rendus au LLM"}>
        {horsCorpus
          ? `Le meilleur score est sous le ${nom} de ${formaterScore(ecart)}\u00a0: loin de tout passage, l'outil le dit au LLM plutôt que de lui donner du hors sujet.`
          : `Le meilleur score dépasse le ${nom} de ${formaterScore(ecart)}\u00a0: les passages passent ensuite au budget.`}
      </Decision>
    </>
  );
}

// Le budget de passages : une barre empilée des tokens de chaque passage gardé, face au budget ; les écartés à part
export function RenduBudget({ etape }: ProprietesRendu) {
  const budget = lireNombre(etape.details, "budget") ?? 0;
  const total = lireNombre(etape.details, "total") ?? 0;
  const gardes = liste(etape.details, "gardes")
    .filter(estObjet)
    .flatMap((g) => {
      const p = passageBref(g);
      return p ? [{ ...p, tokens: lireNombre(g, "tokens") ?? 0 }] : [];
    });
  const ecartes = passagesBrefs(etape.details, "ecartes");
  const echelle = Math.max(budget, total, 1);
  let cumul = 0;
  return (
    <>
      <div className="budget">
        <div className="budget-legende">
          <span>
            <strong>{formaterTokens(total)}</strong> sur {formaterTokens(budget)}
          </span>
          <span className="muet">{pourcentage(total / Math.max(budget, 1))} du budget, estimés</span>
        </div>
        <div className="budget-barre" role="img" aria-label={`${nombre(total)} tokens gardés sur un budget de ${nombre(budget)}, en ${pluriel(gardes.length, "passage")}`}>
          {gardes.map((g, i) => (
            <span key={g.id} className={`budget-segment teinte-${i % 6}`} style={{ width: `${(g.tokens / echelle) * 100}%` }} title={`${g.id}\u00a0: ${formaterTokens(g.tokens)}`} />
          ))}
          <span className="budget-libre" style={{ width: `${(Math.max(0, budget - total) / echelle) * 100}%` }} title={`${formaterTokens(Math.max(0, budget - total))} libres`} />
        </div>
      </div>
      <Section titre="Passages gardés" note="du plus proche au moins proche, tant qu'ils tiennent">
        <div className="tableau-defilant">
          <table className="tableau tableau-passages">
            <thead>
              <tr>
                <th scope="col" className="col-rang">
                  Rang
                </th>
                <th scope="col">Passage</th>
                <th scope="col" className="col-nombre">
                  Tokens
                </th>
                <th scope="col" className="col-nombre">
                  Cumul
                </th>
              </tr>
            </thead>
            <tbody>
              {gardes.map((g, i) => {
                cumul += g.tokens;
                return (
                  <tr key={g.id}>
                    <td className="col-rang">
                      <span className={`budget-puce teinte-${i % 6}`} aria-hidden="true" />
                      {i + 1}
                    </td>
                    <td className="col-passage">
                      <PastillePassage id={g.id} repli={{ titre: g.titre, score: g.score }} />
                      {g.titre && <span className="passage-titre">{g.titre}</span>}
                    </td>
                    <td className="col-nombre">{nombre(g.tokens)}</td>
                    <td className="col-nombre muet">{nombre(cumul)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
      <Section titre="Écartés faute de place" note={ecartes.length === 0 ? "aucun" : pluriel(ecartes.length, "passage")}>
        {ecartes.length === 0 ? (
          <p className="muet rendu-vide">Tous les passages tiennent dans le budget.</p>
        ) : (
          <TableauPassages passages={ecartes} libelleScore="Cosinus" marquer={() => "ligne-ecartee"} />
        )}
      </Section>
    </>
  );
}

export function RenduLimite({ etape }: ProprietesRendu) {
  const raison = texte(etape.details, "raison");
  return (
    <p className="note-rendu alerte">
      <Icone nom="drapeau" taille={14} />{" "}
      {raison === "tokens"
        ? "Le budget de tokens de la question est épuisé\u00a0: ce tour est le dernier, sans outil. Le LLM doit répondre avec ce qu'il a déjà trouvé."
        : "Le nombre de tours est atteint\u00a0: ce tour est le dernier, sans outil. Le LLM doit répondre avec ce qu'il a déjà trouvé."}{" "}
      (tour {lireNombre(etape.details, "tour") ?? "?"})
    </p>
  );
}

export function RenduCitations({ etape }: ProprietesRendu) {
  const citees = passagesBrefs(etape.details, "citees");
  const inventees = textes(etape.details, "inventees");
  return (
    <>
      <Section titre="Sources citées" note="rendues par un outil pendant la conversation">
        <TableauPassages passages={citees} libelleScore="Cosinus" ton="decision" />
      </Section>
      <Section titre="Sources inventées" note="citées, mais rendues par aucun outil (chapitre 10)">
        {inventees.length === 0 ? (
          <p className="muet rendu-vide">Aucune&nbsp;: chaque source citée vient d'un passage lu.</p>
        ) : (
          <div className="pastilles-ligne">
            {inventees.map((id) => (
              <PastillePassage key={id} id={id} inventee />
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
