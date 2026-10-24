// La fusion des rangs (RRF) : pour chaque passage gardé, son rang dans la recherche vectorielle et dans la recherche plein
// texte, sa part de score, et le mouvement des rangs, en image : chaque passage relie sa place dans chaque recherche à sa
// place après la fusion
import { useMemo, useState } from "react";
import { BarreScore, Definitions } from "../../composants/elements.tsx";
import { PastillePassage } from "../../composants/PastillePassage.tsx";
import { decimal, nombre } from "../../outils/format.ts";
import { estObjet, liste, nombre as lireNombre, objet, passagesBrefs, texte } from "../../outils/lecture.ts";
import type { EtapeVue } from "../../types.ts";
import { Section, type ProprietesRendu } from "./communs.tsx";
import { Mouvement } from "./recherche.tsx";

type Ligne = { id: string; vectoriel: number | null; pleinTexte: number | null; rrf: number; titre: string };

// Les titres des passages : la fusion ne garde que leurs identifiants, les recherches sœurs les ont
function titresVoisins(etapes: EtapeVue[], parent: number | null): Map<string, string> {
  const titres = new Map<string, string>();
  for (const e of etapes) {
    if (e.parent !== parent || !("details" in e)) continue;
    if (e.nom !== "recherche-vectorielle" && e.nom !== "recherche-plein-texte") continue;
    for (const p of passagesBrefs(e.details, "candidats")) if (p.titre) titres.set(p.id, p.titre);
  }
  return titres;
}

export function RenduFusion({ etape, contexte }: ProprietesRendu) {
  const poids = objet(etape.details, "poids");
  const kRrf = lireNombre(etape.details, "k_rrf") ?? 60;
  const titres = useMemo(() => titresVoisins(contexte.etapes, etape.parent), [contexte.etapes, etape.parent]);
  const lignes: Ligne[] = liste(etape.details, "passages")
    .filter(estObjet)
    .flatMap((p) => {
      const id = texte(p, "id");
      return id ? [{ id, vectoriel: lireNombre(p, "rang_vectoriel") ?? null, pleinTexte: lireNombre(p, "rang_plein_texte") ?? null, rrf: lireNombre(p, "score_rrf") ?? 0, titre: titres.get(id) ?? "" }] : [];
    });
  const pv = lireNombre(poids, "vectorielle") ?? 1;
  const pp = lireNombre(poids, "plein_texte") ?? 1;
  const max = Math.max(...lignes.map((l) => l.rrf), 1e-9);
  const [survol, setSurvol] = useState<string | null>(null);
  return (
    <>
      <Definitions
        lignes={[
          ["Constante k", <span className="mono">{nombre(kRrf)}</span>],
          ["Poids", <>vectorielle {decimal(pv, 1)}, plein texte {decimal(pp, 1)}</>],
          ["Score RRF", <span className="formule">poids ÷ (k + rang), additionné sur les deux recherches</span>],
        ]}
      />
      <Section titre="Mouvement des rangs" note="à gauche, le rang dans la recherche vectorielle&#8239;; à droite, dans le plein texte">
        <PenteDesRangs lignes={lignes} survol={survol} onSurvol={setSurvol} />
      </Section>
      <Section titre="Passages gardés" note="dans l'ordre de la fusion">
        <div className="tableau-defilant">
          <table className="tableau tableau-passages">
            <thead>
              <tr>
                <th scope="col" className="col-rang">
                  Rang
                </th>
                <th scope="col">Passage</th>
                <th scope="col" className="col-rang" title="Rang dans la recherche vectorielle">
                  Vect.
                </th>
                <th scope="col" className="col-rang" title="Rang dans la recherche plein texte">
                  Plein t.
                </th>
                <th scope="col" className="col-score">
                  Score RRF
                </th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l, i) => (
                <tr key={l.id} className={survol === l.id ? "ligne-survolee" : undefined} onMouseEnter={() => setSurvol(l.id)} onMouseLeave={() => setSurvol(null)}>
                  <td className="col-rang">{i + 1}</td>
                  <td className="col-passage">
                    <PastillePassage id={l.id} repli={{ titre: l.titre }} />
                    {l.titre && <span className="passage-titre">{l.titre}</span>}
                  </td>
                  <td className="col-rang">
                    <span className="rang-origine">{l.vectoriel ?? "–"}</span>
                    <Mouvement avant={l.vectoriel} apres={i + 1} />
                  </td>
                  <td className="col-rang">
                    <span className="rang-origine">{l.pleinTexte ?? "–"}</span>
                    <Mouvement avant={l.pleinTexte} apres={i + 1} />
                  </td>
                  <td className="col-score">
                    <BarreScore rapport={l.rrf / max} valeur={decimal(l.rrf, 5)} ton="recherche" libelle={`Score RRF de ${l.id}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}

const HAUTEUR_RANG = 30;
const HAUT = 30;
const X_GAUCHE = 11;
const X_DROITE = 89;
const BORD_GAUCHE = 31;
const BORD_DROIT = 69;

// Trois colonnes : la recherche vectorielle, la fusion, le plein texte. Chaque passage relie sa place dans chaque
// recherche (classée parmi les passages gardés, avec son vrai rang écrit dans la pastille) à sa place après la fusion
function PenteDesRangs({ lignes, survol, onSurvol }: { lignes: Ligne[]; survol: string | null; onSurvol: (id: string | null) => void }) {
  const ordre = (cle: "vectoriel" | "pleinTexte") => {
    const tries = [...lignes].sort((a, b) => (a[cle] ?? Infinity) - (b[cle] ?? Infinity));
    return new Map(tries.map((l, i) => [l.id, i]));
  };
  const gauche = ordre("vectoriel");
  const droite = ordre("pleinTexte");
  const y = (i: number) => HAUT + i * HAUTEUR_RANG + HAUTEUR_RANG / 2;
  const hauteur = HAUT + lignes.length * HAUTEUR_RANG + 6;
  const resume = lignes.map((l, i) => `${l.id}\u00a0: rang ${i + 1} après la fusion, ${l.vectoriel ?? "absent"} en vectorielle, ${l.pleinTexte ?? "absent"} en plein texte`).join("\u202f; ");
  return (
    <div className={`pente${survol ? " avec-survol" : ""}`} style={{ height: hauteur }} role="img" aria-label={resume}>
      <span className="pente-colonne" style={{ left: `${X_GAUCHE}%` }}>
        Vectorielle
      </span>
      <span className="pente-colonne" style={{ left: "50%" }}>
        Fusion RRF
      </span>
      <span className="pente-colonne" style={{ left: `${X_DROITE}%` }}>
        Plein texte
      </span>
      <svg className="pente-traits" viewBox={`0 0 100 ${hauteur}`} preserveAspectRatio="none" aria-hidden="true">
        {lignes.map((l, i) => {
          const ym = y(i);
          const yg = y(gauche.get(l.id) ?? i);
          const yd = y(droite.get(l.id) ?? i);
          const classe = survol === l.id ? " en-avant" : "";
          return (
            <g key={l.id}>
              <path
                className={`pente-trait trait-vectoriel${l.vectoriel === null ? " absent" : ""}${classe}`}
                d={`M ${X_GAUCHE} ${yg} C ${(X_GAUCHE + BORD_GAUCHE) / 2} ${yg}, ${(X_GAUCHE + BORD_GAUCHE) / 2} ${ym}, ${BORD_GAUCHE} ${ym}`}
              />
              <path
                className={`pente-trait trait-plein-texte${l.pleinTexte === null ? " absent" : ""}${classe}`}
                d={`M ${BORD_DROIT} ${ym} C ${(BORD_DROIT + X_DROITE) / 2} ${ym}, ${(BORD_DROIT + X_DROITE) / 2} ${yd}, ${X_DROITE} ${yd}`}
              />
            </g>
          );
        })}
      </svg>
      {lignes.map((l, i) => {
        const classe = survol === l.id ? " en-avant" : "";
        return (
          <div key={l.id} onMouseEnter={() => onSurvol(l.id)} onMouseLeave={() => onSurvol(null)}>
            <span className={`pente-rang rang-vectoriel${l.vectoriel === null ? " absent" : ""}${classe}`} style={{ left: `${X_GAUCHE}%`, top: y(gauche.get(l.id) ?? i) }}>
              {l.vectoriel ?? "–"}
            </span>
            <span className={`pente-passage${classe}`} style={{ left: `${BORD_GAUCHE}%`, right: `${100 - BORD_DROIT}%`, top: y(i) }} title={l.titre ? `${l.id} · ${l.titre}` : l.id}>
              <span className="pente-passage-rang">{i + 1}</span>
              <span className="mono une-ligne">{l.id}</span>
            </span>
            <span className={`pente-rang rang-plein-texte${l.pleinTexte === null ? " absent" : ""}${classe}`} style={{ left: `${X_DROITE}%`, top: y(droite.get(l.id) ?? i) }}>
              {l.pleinTexte ?? "–"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
