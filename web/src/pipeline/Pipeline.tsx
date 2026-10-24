// Le pipeline d'une réponse : le bilan en tête, l'arbre des étapes en cascade temporelle (comme l'onglet Réseau d'un
// navigateur), et le détail de l'étape choisie. Le même composant sert la conversation, la recherche seule et chaque
// question d'une évaluation. Au clavier : ↑ ↓ pour passer d'une étape à l'autre, ← → pour replier et déplier, Entrée
// pour ouvrir le détail, Échap pour le fermer
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icone } from "../composants/Icone.tsx";
import { defilerJusqua } from "../outils/defilement.ts";
import { duree as formaterDuree, typographie } from "../outils/format.ts";
import { estTerminee, type EtapeVue, type Tarifs } from "../types.ts";
import { arbreDe, bilanDe, finDe, lignesDe, type LigneEtape } from "./calculs.ts";
import { DetailEtape } from "./DetailEtape.tsx";
import { EnTetePipeline } from "./EnTetePipeline.tsx";
import { familleDe, iconeDe } from "./familles.ts";

type Proprietes = {
  etapes: EtapeVue[];
  tarifs: Tarifs | null;
  enCours?: boolean;
  debutLocal?: number; // performance.now() au départ de la question : la durée d'une étape en cours
  dureeTotale?: number; // la durée que mesure le serveur, quand la réponse est finie
  vide?: ReactNode;
  libelle?: string;
};

// L'horloge d'une réponse en cours : elle avance dix fois par seconde, et s'arrête avec la réponse
function useMaintenant(enCours: boolean, debutLocal: number | undefined): number {
  const [maintenant, setMaintenant] = useState(() => (debutLocal === undefined ? 0 : performance.now() - debutLocal));
  useEffect(() => {
    if (!enCours || debutLocal === undefined) return;
    const minuterie = window.setInterval(() => setMaintenant(performance.now() - debutLocal), 100);
    return () => window.clearInterval(minuterie);
  }, [enCours, debutLocal]);
  return enCours ? maintenant : 0;
}

export function Pipeline({ etapes, tarifs, enCours = false, debutLocal, dureeTotale, vide, libelle = "Étapes de la réponse" }: Proprietes) {
  const horloge = useMaintenant(enCours, debutLocal);
  const arbre = useMemo(() => arbreDe(etapes), [etapes]);
  const [repliees, setRepliees] = useState<ReadonlySet<number>>(() => new Set());
  const lignes = useMemo(() => lignesDe(arbre, repliees), [arbre, repliees]);
  const [selection, setSelection] = useState<number | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const liste = useRef<HTMLDivElement>(null);
  const suivreLaFin = useRef(true);

  // Le temps de référence : la dernière fin connue, ou l'horloge pendant la réponse
  const maintenant = Math.max(horloge, ...etapes.map((e) => (estTerminee(e) ? e.debut_ms + e.duree_ms : e.debut_ms)));
  const bilan = useMemo(() => bilanDe(etapes, tarifs, maintenant), [etapes, tarifs, maintenant]);
  const total = Math.max(1, dureeTotale ?? 0, bilan.duree);

  const choisie = selection === null ? undefined : arbre.parId.get(selection);
  const focusEffectif = focus !== null && lignes.some((l) => l.etape.id === focus) ? focus : (lignes[0]?.etape.id ?? null);

  // Pendant la réponse, la liste suit les nouvelles étapes, sauf si on est remonté la lire
  useLayoutEffect(() => {
    const el = liste.current;
    if (el && enCours && suivreLaFin.current) el.scrollTop = el.scrollHeight;
  }, [lignes.length, enCours]);

  // Le focus passe tout de suite à la ligne (une touche maintenue enchaîne les étapes sans attendre le rendu) ; une
  // ligne qui vient d'apparaître (après un dépliage) le reçoit à l'image suivante
  // L'étape choisie reste visible dans la liste, même quand le détail qui s'ouvre la réduit
  useEffect(() => {
    if (selection === null) return;
    const ligne = liste.current?.querySelector<HTMLElement>(`[data-etape="${selection}"]`);
    if (ligne) requestAnimationFrame(() => defilerJusqua(ligne, { seulementSiCache: true }));
  }, [selection]);

  const deplacerFocus = useCallback((id: number, ouvrir: boolean) => {
    setFocus(id);
    if (ouvrir) setSelection(id);
    const ligne = () => liste.current?.querySelector<HTMLElement>(`[data-etape="${id}"]`);
    const el = ligne();
    if (el) el.focus();
    else requestAnimationFrame(() => ligne()?.focus());
  }, []);

  const basculer = useCallback((id: number) => {
    setRepliees((r) => {
      const n = new Set(r);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const choisir = useCallback((id: number) => {
    setFocus(id);
    setSelection((s) => (s === id ? null : id));
  }, []);

  const fermer = useCallback(() => {
    if (selection !== null) deplacerFocus(selection, false);
    setSelection(null);
  }, [selection, deplacerFocus]);

  const surTouche = (e: KeyboardEvent<HTMLDivElement>) => {
    // La ligne qui a le focus dans la page, plutôt que l'état (qui peut avoir une touche de retard)
    const active = (e.target as HTMLElement).closest<HTMLElement>("[data-etape]")?.dataset.etape;
    const courante = active !== undefined ? Number(active) : focusEffectif;
    const i = lignes.findIndex((l) => l.etape.id === courante);
    if (i < 0) return;
    const ligne = lignes[i];
    const ouvrir = selection !== null;
    switch (e.key) {
      case "ArrowDown":
        if (i < lignes.length - 1) deplacerFocus(lignes[i + 1].etape.id, ouvrir);
        break;
      case "ArrowUp":
        if (i > 0) deplacerFocus(lignes[i - 1].etape.id, ouvrir);
        break;
      case "Home":
        deplacerFocus(lignes[0].etape.id, ouvrir);
        break;
      case "End":
        deplacerFocus(lignes[lignes.length - 1].etape.id, ouvrir);
        break;
      case "ArrowRight":
        if (ligne.enfants > 0 && repliees.has(ligne.etape.id)) basculer(ligne.etape.id);
        else if (ligne.enfants > 0 && lignes[i + 1]) deplacerFocus(lignes[i + 1].etape.id, ouvrir);
        break;
      case "ArrowLeft":
        if (ligne.enfants > 0 && !repliees.has(ligne.etape.id)) basculer(ligne.etape.id);
        else if (ligne.etape.parent !== null && arbre.parId.has(ligne.etape.parent)) deplacerFocus(ligne.etape.parent, ouvrir);
        break;
      case "Enter":
      case " ":
        choisir(ligne.etape.id);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  if (etapes.length === 0) {
    return <div className="pipeline pipeline-vide">{vide}</div>;
  }

  return (
    <div
      className="pipeline"
      onKeyDown={(e) => {
        if (e.key === "Escape" && selection !== null) {
          e.stopPropagation();
          fermer();
        }
      }}
    >
      <EnTetePipeline bilan={bilan} total={total} enCours={enCours} etapes={etapes.length} />
      <div className={`pipeline-corps${choisie ? " avec-detail" : ""}`}>
        <div className="pipeline-liste">
          <div className="cascade-entete" aria-hidden="true">
            <span>Étape</span>
            <Graduations total={total} />
            <span className="cascade-entete-duree">Durée</span>
          </div>
          <div
            ref={liste}
            className="cascade-lignes"
            role="tree"
            aria-label={libelle}
            onKeyDown={surTouche}
            onScroll={(e) => {
              const el = e.currentTarget;
              suivreLaFin.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
            }}
          >
            {lignes.map((l) => (
              <LigneDEtape
                key={l.etape.id}
                ligne={l}
                total={total}
                maintenant={maintenant}
                choisie={l.etape.id === selection}
                focusable={l.etape.id === focusEffectif}
                repliee={repliees.has(l.etape.id)}
                onChoisir={choisir}
                onBasculer={basculer}
              />
            ))}
          </div>
        </div>
        {choisie && <DetailEtape etape={choisie} etapes={etapes} tarifs={tarifs} maintenant={maintenant} onFermer={fermer} />}
      </div>
    </div>
  );
}

function Graduations({ total }: { total: number }) {
  return (
    <span className="cascade-graduations">
      {[0, 0.25, 0.5, 0.75, 1].map((r) => (
        <span key={r} className="cascade-graduation" style={{ left: `${r * 100}%` }}>
          {r === 0 ? "0" : formaterDuree(total * r)}
        </span>
      ))}
    </span>
  );
}

type ProprietesLigne = {
  ligne: LigneEtape;
  total: number;
  maintenant: number;
  choisie: boolean;
  focusable: boolean;
  repliee: boolean;
  onChoisir: (id: number) => void;
  onBasculer: (id: number) => void;
};

const LigneDEtape = memo(function LigneDEtape({ ligne, total, maintenant, choisie, focusable, repliee, onChoisir, onBasculer }: ProprietesLigne) {
  const { etape, profondeur, enfants } = ligne;
  const terminee = estTerminee(etape);
  const famille = familleDe(etape.nom);
  const duree = finDe(etape, maintenant) - etape.debut_ms;
  const statut = etape.statut;
  const resume = terminee ? typographie(etape.resume) : statut === "interrompue" ? "interrompue avant la fin" : "en cours…";
  const gauche = (etape.debut_ms / total) * 100;
  const largeur = (duree / total) * 100;
  const instantanee = terminee && etape.duree_ms === 0;
  const libelleStatut = { "en-cours": "en cours", interrompue: "interrompue", erreur: "en erreur", ok: "réussie" }[statut];
  return (
    <div
      className={`cascade-ligne famille-${famille}${choisie ? " choisie" : ""} statut-${statut}`}
      role="treeitem"
      aria-level={profondeur + 1}
      aria-expanded={enfants > 0 ? !repliee : undefined}
      aria-selected={choisie}
      aria-label={`${etape.titre}, ${libelleStatut}, ${terminee ? formaterDuree(duree) : "en cours"}\u00a0: ${resume}`}
      tabIndex={focusable ? 0 : -1}
      data-etape={etape.id}
      onClick={() => onChoisir(etape.id)}
    >
      <span className="cascade-nom" style={{ paddingLeft: `${profondeur * 16}px` }}>
        {enfants > 0 ? (
          <button
            type="button"
            className="cascade-basculer"
            tabIndex={-1}
            aria-hidden="true"
            onClick={(e) => {
              e.stopPropagation();
              onBasculer(etape.id);
            }}
          >
            <Icone nom={repliee ? "chevron-droite" : "chevron-bas"} taille={12} />
          </button>
        ) : (
          <span className="cascade-basculer-vide" />
        )}
        <span className="cascade-icone">
          {statut === "en-cours" ? (
            <Icone nom="attente" taille={14} className="tourne" />
          ) : statut === "interrompue" ? (
            <Icone nom="interdit" taille={14} />
          ) : statut === "erreur" ? (
            <Icone nom="erreur" taille={14} />
          ) : (
            <Icone nom={iconeDe(etape.nom)} taille={14} />
          )}
        </span>
        <span className="cascade-textes">
          <span className="cascade-titre">{etape.titre}</span>
          <span className="cascade-resume" title={resume}>
            {resume}
          </span>
        </span>
      </span>
      <span className="cascade-piste" aria-hidden="true">
        {instantanee ? (
          <span className="cascade-instant" style={{ left: `${gauche}%` }} />
        ) : (
          <span className="cascade-barre" style={{ left: `${gauche}%`, width: `max(${largeur}%, 2px)` }} />
        )}
      </span>
      <span className="cascade-duree">{instantanee || statut === "interrompue" ? "–" : formaterDuree(duree)}</span>
    </div>
  );
});
