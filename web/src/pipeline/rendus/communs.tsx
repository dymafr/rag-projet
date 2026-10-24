// Les briques des rendus d'étapes : une section titrée, le tableau des passages avec leur score, les filtres d'une
// recherche, les tokens d'un appel au LLM et son coût
import type { ReactNode } from "react";
import { ArbreJson } from "../../composants/ArbreJson.tsx";
import { BarreScore, Pastille, type Ton } from "../../composants/elements.tsx";
import { PastilleAcces } from "../../composants/PastilleAcces.tsx";
import { PastillePassage } from "../../composants/PastillePassage.tsx";
import { cout as formaterCout, date, decimal, nombre, pourcentage, score as formaterScore } from "../../outils/format.ts";
import { estObjet, textes, type Objet, type PassageBref } from "../../outils/lecture.ts";
import type { EtapeTracee, EtapeVue, Tarifs, Usage } from "../../types.ts";
import { coutDUnAppel, estLocal, tarifDe } from "../calculs.ts";

export type ContexteRendu = { tarifs: Tarifs | null; etapes: EtapeVue[] };
export type ProprietesRendu = { etape: EtapeTracee; contexte: ContexteRendu };

export function Section({ titre, actions, children, note }: { titre: ReactNode; actions?: ReactNode; children: ReactNode; note?: ReactNode }) {
  return (
    <section className="rendu-section">
      <div className="rendu-section-entete">
        <h4>{titre}</h4>
        {note && <span className="muet petit">{note}</span>}
        {actions && <span className="rendu-section-actions">{actions}</span>}
      </div>
      {children}
    </section>
  );
}

// Le tableau d'une liste de passages classés. echelle : cosinus (de 0 à 1), relatif (au premier : un score BM25 n'a pas
// de maximum), ou aucune barre
type Colonne = { titre: string; cellule: (p: PassageBref, rang: number) => ReactNode; classe?: string };

export function TableauPassages({
  passages,
  echelle = "cosinus",
  colonnes = [],
  libelleScore = "Score",
  ton = "recherche",
  marquer,
}: {
  passages: PassageBref[];
  echelle?: "cosinus" | "relatif" | "aucune";
  colonnes?: Colonne[];
  libelleScore?: string;
  ton?: Ton;
  marquer?: (p: PassageBref) => string | undefined; // une classe de ligne (gardé, écarté…)
}) {
  if (passages.length === 0) return <p className="muet rendu-vide">Aucun passage.</p>;
  const premier = Math.max(...passages.map((p) => p.score), 0);
  return (
    <div className="tableau-defilant">
      <table className="tableau tableau-passages">
        <thead>
          <tr>
            <th scope="col" className="col-rang">
              Rang
            </th>
            <th scope="col">Passage</th>
            {colonnes.map((c) => (
              <th scope="col" key={c.titre} className={c.classe}>
                {c.titre}
              </th>
            ))}
            {echelle !== "aucune" && (
              <th scope="col" className="col-score">
                {libelleScore}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {passages.map((p, i) => (
            <tr key={`${p.id}-${i}`} className={marquer?.(p)}>
              <td className="col-rang">{i + 1}</td>
              <td className="col-passage">
                <PastillePassage id={p.id} repli={{ titre: p.titre, score: p.score }} />
                {p.titre && <span className="passage-titre">{p.titre}</span>}
              </td>
              {colonnes.map((c) => (
                <td key={c.titre} className={c.classe}>
                  {c.cellule(p, i + 1)}
                </td>
              ))}
              {echelle !== "aucune" && (
                <td className="col-score">
                  <BarreScore
                    rapport={echelle === "cosinus" ? p.score : premier > 0 ? p.score / premier : 0}
                    valeur={echelle === "cosinus" ? formaterScore(p.score) : decimal(p.score, 2)}
                    ton={ton}
                    libelle={`${libelleScore} de ${p.id}`}
                  />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Les filtres d'une recherche : la date de vigueur, les niveaux d'accès, les types, la langue
export function Filtres({ filtres }: { filtres: Objet | undefined }) {
  if (!filtres) return null;
  const elements: ReactNode[] = [];
  if (typeof filtres.enVigueurLe === "string") elements.push(<Pastille key="date" icone="calendrier">en vigueur le {date(filtres.enVigueurLe)}</Pastille>);
  for (const n of textes(filtres, "acces")) elements.push(<PastilleAcces key={`acces-${n}`} acces={n} />);
  for (const t of textes(filtres, "types")) elements.push(<Pastille key={`type-${t}`} icone="filtre">type {t}</Pastille>);
  if (typeof filtres.langue === "string") elements.push(<Pastille key="langue">langue {filtres.langue}</Pastille>);
  const connus = new Set(["enVigueurLe", "acces", "types", "langue"]);
  const autres = Object.entries(filtres).filter(([k]) => !connus.has(k));
  return (
    <div className="filtres-etape">
      {elements.length > 0 ? elements : <span className="muet">aucun filtre</span>}
      {autres.length > 0 && <ArbreJson valeur={Object.fromEntries(autres)} copier={false} />}
    </div>
  );
}

// Les tokens d'un appel au LLM, et son coût d'après les tarifs du serveur
export function JetonsLlm({ etape, tarifs, usage = etape.usage }: { etape: Pick<EtapeTracee, "modele" | "usage">; tarifs: Tarifs | null; usage?: Usage }) {
  if (!usage) return null;
  const tarif = tarifDe(etape, tarifs);
  const prix = tarif ? coutDUnAppel(usage, tarif) : null;
  const local = estLocal(etape.modele?.fournisseur);
  const valeurCout = prix ? (Math.abs(prix.max - prix.min) < 1e-9 ? formaterCout(prix.min) : `${formaterCout(prix.min)} à ${formaterCout(prix.max)}`) : local ? formaterCout(0) : "inconnu";
  return (
    <div className="jetons">
      <Jeton libelle="Entrée" valeur={nombre(usage.entree)} />
      <Jeton libelle="Cache relu" valeur={nombre(usage.enCache)} detail={usage.entree > 0 ? `${pourcentage(usage.enCache / usage.entree)} de l'entrée` : undefined} />
      <Jeton libelle="Cache écrit" valeur={usage.ecritCache === undefined ? "non dit" : nombre(usage.ecritCache)} />
      <Jeton libelle="Sortie" valeur={nombre(usage.sortie)} />
      <Jeton libelle="Coût estimé" valeur={valeurCout} detail={prix ? "tarifs du serveur" : local ? "modèle local" : "modèle sans tarif"} />
    </div>
  );
}

function Jeton({ libelle, valeur, detail }: { libelle: string; valeur: string; detail?: string }) {
  return (
    <div className="jeton">
      <span className="jeton-libelle">{libelle}</span>
      <span className="jeton-valeur">{valeur}</span>
      {detail && <span className="jeton-detail">{detail}</span>}
    </div>
  );
}

export function Modele({ etape }: { etape: Pick<EtapeTracee, "modele"> }) {
  if (!etape.modele) return null;
  return (
    <Pastille ton="llm" icone={estLocal(etape.modele.fournisseur) ? "machine" : "globe"} mono>
      {etape.modele.fournisseur} {etape.modele.modele}
    </Pastille>
  );
}

// Un JSON lisible, pour les arguments d'un appel par exemple
export function JsonLisible({ valeur }: { valeur: unknown }) {
  if (!estObjet(valeur) && !Array.isArray(valeur)) return <code className="mono">{JSON.stringify(valeur)}</code>;
  return <ArbreJson valeur={valeur} ouvert={3} />;
}
