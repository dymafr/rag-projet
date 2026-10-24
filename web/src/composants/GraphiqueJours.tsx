// Un graphique par jour, dessiné à la main en SVG : colonnes empilées, lignes, ou colonnes de part et d'autre de zéro.
// Une seule échelle verticale, des marques fines, une grille discrète ; une légende dès deux séries ; au survol (ou au
// clavier, ← →), une ligne de repère et une infobulle qui donne toutes les séries du jour. Les chiffres restent lisibles
// sans survol : la vue offre aussi le tableau jour par jour
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";

export type Serie = { cle: string; libelle: string; couleur: string; valeurs: (number | null)[] };

type Proprietes = {
  titre: string;
  sousTitre?: string;
  jours: string[]; // AAAA-MM-JJ, continus
  forme: "colonnes" | "lignes" | "divergent";
  series: Serie[]; // colonnes : empilées de bas en haut ; divergent : la première au-dessus de zéro, la seconde en dessous
  format: (v: number) => string;
  formatAxe?: (v: number) => string;
  reference?: { valeur: number; libelle: string };
  domaine?: [number, number];
  hauteur?: number;
  entiers?: boolean; // des comptes : des graduations entières
};

const MARGE = { haut: 14, droite: 14, bas: 26, gauche: 52 };
const jourCourt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
const jourLong = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const lireJour = (iso: string) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const premier = (t: string) => t.replace(/^(\D*)1 /, "$11er ");

// Un pas « rond » (1, 2, 5 × 10ⁿ) pour quatre graduations environ ; entier pour des comptes
function graduations(max: number, entiers = false): number[] {
  if (max <= 0) return [0, 1];
  const brut = max / 4;
  const puissance = 10 ** Math.floor(Math.log10(brut));
  const rond = [1, 2, 2.5, 5, 10].map((m) => m * puissance).find((p) => p >= brut) ?? brut;
  const pas = entiers ? Math.max(1, Math.round(rond)) : rond;
  const fin = Math.ceil(max / pas - 1e-9) * pas;
  const liste: number[] = [];
  for (let v = 0; v <= fin + pas / 2; v += pas) liste.push(Number(v.toFixed(10)));
  return liste;
}

function useLargeur<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [largeur, setLargeur] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observateur = new ResizeObserver(([e]) => setLargeur(Math.max(240, Math.round(e.contentRect.width))));
    observateur.observe(el);
    return () => observateur.disconnect();
  }, []);
  return [ref, largeur];
}

// Une colonne aux coins du haut arrondis (4 px), carrée sur sa base
function colonne(x: number, y: number, l: number, h: number, versLeHaut: boolean): string {
  const r = Math.min(4, l / 2, h);
  if (h <= 0) return "";
  if (versLeHaut) return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + l - r}Q${x + l},${y} ${x + l},${y + r}V${y + h}Z`;
  return `M${x},${y}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + l - r}Q${x + l},${y + h} ${x + l},${y + h - r}V${y}Z`;
}

export function GraphiqueJours({ titre, sousTitre, jours, forme, series, format, formatAxe = format, reference, domaine, hauteur = 200, entiers = false }: Proprietes) {
  const [cadre, largeur] = useLargeur<HTMLDivElement>();
  const [actif, setActif] = useState<number | null>(null);
  const idResume = useId();
  const n = jours.length;
  const l = largeur - MARGE.gauche - MARGE.droite;
  const h = hauteur - MARGE.haut - MARGE.bas;
  const bande = n > 0 ? l / n : l;
  const xCentre = (i: number) => MARGE.gauche + i * bande + bande / 2;

  const { ticks, y, zero } = useMemo(() => {
    const valeurs = (s: Serie) => s.valeurs.map((v) => v ?? 0);
    let max: number;
    if (domaine) max = domaine[1];
    else if (forme === "colonnes") max = Math.max(0, ...jours.map((_, i) => series.reduce((s, serie) => s + (serie.valeurs[i] ?? 0), 0)));
    else if (forme === "divergent") max = Math.max(0, ...series.flatMap(valeurs));
    else max = Math.max(0, ...series.flatMap(valeurs), reference?.valeur ?? 0);
    const t = domaine ? graduations(domaine[1]).filter((v) => v >= domaine[0]) : graduations(max, entiers);
    const haut = t.at(-1) ?? 1;
    if (forme === "divergent") {
      const echelle = (v: number) => MARGE.haut + h / 2 - (v / haut) * (h / 2);
      return { ticks: [...t.slice(1).map((v) => -v).reverse(), ...t], y: echelle, zero: echelle(0) };
    }
    const bas = domaine ? domaine[0] : 0;
    const echelle = (v: number) => MARGE.haut + h - ((v - bas) / (haut - bas)) * h;
    return { ticks: t, y: echelle, zero: echelle(bas) };
  }, [domaine, forme, jours, series, reference, h, entiers]);

  const pasDesDates = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(l / 90))));
  const largeurColonne = Math.max(2, Math.min(24, bande * 0.62));

  const choisir = (e: PointerEvent<SVGRectElement>) => {
    const boite = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - boite.left) / bande);
    setActif(Math.max(0, Math.min(n - 1, i)));
  };
  const surTouche = (e: KeyboardEvent<HTMLDivElement>) => {
    if (n === 0) return;
    const i = actif ?? n - 1;
    const suivant = e.key === "ArrowLeft" ? i - 1 : e.key === "ArrowRight" ? i + 1 : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (suivant === null) return;
    e.preventDefault();
    setActif(Math.max(0, Math.min(n - 1, suivant)));
  };

  const infobulle = actif !== null && actif < n ? actif : null;
  const resumeActif =
    infobulle === null ? "" : `${premier(jourLong.format(lireJour(jours[infobulle])))}\u00a0: ${series.map((s) => `${s.libelle} ${s.valeurs[infobulle] === null ? "aucune valeur" : format(s.valeurs[infobulle] ?? 0)}`).join(", ")}`;

  return (
    <figure className="graphique">
      <figcaption className="graphique-entete">
        <span className="graphique-titre">{titre}</span>
        {sousTitre && <span className="graphique-sous-titre">{sousTitre}</span>}
      </figcaption>
      {series.length >= 2 && (
        <ul className="graphique-legende" aria-label="Légende">
          {series.map((s) => (
            <li key={s.cle}>
              <span className={`legende-cle ${forme === "lignes" ? "ligne" : "aire"}`} style={{ background: s.couleur }} aria-hidden="true" />
              {s.libelle}
            </li>
          ))}
        </ul>
      )}
      <div
        ref={cadre}
        className="graphique-cadre"
        tabIndex={0}
        role="group"
        aria-label={`${titre}\u00a0: graphique par jour. Flèches gauche et droite pour lire chaque jour`}
        aria-describedby={idResume}
        onKeyDown={surTouche}
        onFocus={() => setActif((a) => a ?? n - 1)}
        onBlur={() => setActif(null)}
      >
        <svg width={largeur} height={hauteur} aria-hidden="true">
          {ticks.map((t) => (
            <g key={t}>
              <line className={t === 0 ? "graphique-zero" : "graphique-grille"} x1={MARGE.gauche} x2={largeur - MARGE.droite} y1={y(t)} y2={y(t)} />
              <text className="graphique-axe" x={MARGE.gauche - 8} y={y(t)} dy="0.32em" textAnchor="end">
                {t === 0 ? "0" : formatAxe(Math.abs(t))}
              </text>
            </g>
          ))}
          {jours.map((j, i) =>
            i % pasDesDates === 0 || i === n - 1 ? (
              <text key={j} className="graphique-axe" x={xCentre(i)} y={hauteur - 8} textAnchor={i === n - 1 ? "end" : i === 0 ? "start" : "middle"}>
                {premier(jourCourt.format(lireJour(j)))}
              </text>
            ) : null,
          )}
          {reference && (
            <g>
              <line className="graphique-reference" x1={MARGE.gauche} x2={largeur - MARGE.droite} y1={y(reference.valeur)} y2={y(reference.valeur)} />
              <text className="graphique-axe graphique-reference-texte" x={largeur - MARGE.droite} y={y(reference.valeur) - 5} textAnchor="end">
                {reference.libelle}
              </text>
            </g>
          )}
          {infobulle !== null && forme === "lignes" && <line className="graphique-repere" x1={xCentre(infobulle)} x2={xCentre(infobulle)} y1={MARGE.haut} y2={MARGE.haut + h} />}
          {forme === "colonnes" &&
            jours.map((j, i) => {
              let cumul = 0;
              const segments = series.map((s) => {
                const v = s.valeurs[i] ?? 0;
                const debut = cumul;
                cumul += v;
                return { s, v, debut };
              });
              const dernier = segments.reduce((d, seg, k) => (seg.v > 0 ? k : d), -1);
              return (
                <g key={j} className={infobulle !== null && infobulle !== i ? "graphique-estompe" : undefined}>
                  {segments.map(({ s, v, debut }, k) => {
                    if (v <= 0) return null;
                    const haut = y(debut + v);
                    const hauteurSegment = Math.max(1, y(debut) - haut - (k > 0 && debut > 0 ? 2 : 0));
                    const x = xCentre(i) - largeurColonne / 2;
                    // Seul le haut de la pile est arrondi ; les segments sont séparés par 2 px de fond
                    return k === dernier ? (
                      <path key={s.cle} d={colonne(x, haut, largeurColonne, hauteurSegment, true)} fill={s.couleur} />
                    ) : (
                      <rect key={s.cle} x={x} y={haut} width={largeurColonne} height={hauteurSegment} fill={s.couleur} />
                    );
                  })}
                </g>
              );
            })}
          {forme === "divergent" &&
            jours.map((j, i) => {
              const [plus, moins] = series;
              const vp = plus?.valeurs[i] ?? 0;
              const vm = moins?.valeurs[i] ?? 0;
              return (
                <g key={j} className={infobulle !== null && infobulle !== i ? "graphique-estompe" : undefined}>
                  {vp > 0 && <path d={colonne(xCentre(i) - largeurColonne / 2, y(vp), largeurColonne, zero - y(vp) - 1, true)} fill={plus.couleur} />}
                  {vm > 0 && <path d={colonne(xCentre(i) - largeurColonne / 2, zero + 1, largeurColonne, y(-vm) - zero - 1, false)} fill={moins.couleur} />}
                </g>
              );
            })}
          {forme === "lignes" &&
            series.map((s) => {
              // La ligne s'interrompt sur un jour sans valeur
              let d = "";
              let enCours = false;
              s.valeurs.forEach((v, i) => {
                if (v === null) {
                  enCours = false;
                  return;
                }
                d += `${enCours ? "L" : "M"}${xCentre(i)},${y(v)}`;
                enCours = true;
              });
              const points = s.valeurs.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
              const seuls = points.filter((p) => s.valeurs[p.i - 1] == null && s.valeurs[p.i + 1] == null);
              const fin = points.at(-1);
              return (
                <g key={s.cle}>
                  <path d={d} fill="none" stroke={s.couleur} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  {seuls.map((p) => (
                    <circle key={p.i} className="graphique-point" cx={xCentre(p.i)} cy={y(p.v)} r={4} fill={s.couleur} />
                  ))}
                  {fin && <circle className="graphique-point" cx={xCentre(fin.i)} cy={y(fin.v)} r={4} fill={s.couleur} />}
                  {infobulle !== null && s.valeurs[infobulle] !== null && <circle className="graphique-point" cx={xCentre(infobulle)} cy={y(s.valeurs[infobulle] ?? 0)} r={5} fill={s.couleur} />}
                </g>
              );
            })}
          <rect className="graphique-capture" x={MARGE.gauche} y={MARGE.haut} width={Math.max(0, l)} height={Math.max(0, h)} onPointerMove={choisir} onPointerDown={choisir} onPointerLeave={() => setActif(null)} />
        </svg>
        {infobulle !== null && (
          <div className="graphique-infobulle" style={{ left: Math.min(Math.max(xCentre(infobulle), 90), largeur - 90), top: MARGE.haut }} aria-hidden="true">
            <p className="graphique-infobulle-date">{premier(jourLong.format(lireJour(jours[infobulle])))}</p>
            {series.map((s) => (
              <p key={s.cle} className="graphique-infobulle-ligne">
                <span className="legende-cle ligne" style={{ background: s.couleur }} />
                <strong>{s.valeurs[infobulle] === null ? "–" : format(s.valeurs[infobulle] ?? 0)}</strong>
                <span>{s.libelle}</span>
              </p>
            ))}
          </div>
        )}
        <span id={idResume} className="visuellement-cache" aria-live="polite">
          {resumeActif}
        </span>
      </div>
    </figure>
  );
}
