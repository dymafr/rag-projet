// Les briques des vues d'évaluation : l'anneau du score, les barres par type, profil ou catégorie, le verdict d'une
// question, et les libellés du jeu d'évaluation
import { Pastille, type Ton } from "../../composants/elements.tsx";
import { nombre, pourcentage } from "../../outils/format.ts";
import type { Bilan } from "../../types.ts";

export const TYPES: Record<string, string> = {
  "un-passage": "un passage",
  "plusieurs-passages": "plusieurs passages",
  "date-version": "date et version",
  conversation: "conversation",
  "hors-corpus": "hors corpus",
  interdite: "interdite",
  "donnees-structurees": "données structurées",
  "document-scanne": "document scanné",
  multilingue: "multilingue",
};

export const CATEGORIES: Record<string, string> = { couverte: "couverte", "hors-corpus": "hors corpus", interdite: "interdite" };

export const CRITERES: Record<string, string> = {
  exactitude: "Exactitude",
  fidelite: "Fidélité",
  refus: "Refus",
  attendu: "Motifs attendus",
  interdit: "Motifs interdits",
};

export const libelleType = (t: string) => TYPES[t] ?? t;

// Le taux de réussite : sur les questions jugées (une question non jugée ne compte ni pour ni contre)
export const taux = (b: Bilan) => (b.jugees > 0 ? b.reussies / b.jugees : 0);

export function AnneauScore({ bilan, taille = 84 }: { bilan: Bilan; taille?: number }) {
  const r = 15.5;
  const circonference = 2 * Math.PI * r;
  const t = taux(bilan);
  const ton = t >= 0.9 ? "ok" : t >= 0.7 ? "alerte" : "erreur";
  return (
    <div className={`anneau ton-${ton}`} style={{ width: taille, height: taille }} role="img" aria-label={`${nombre(bilan.reussies)} réussies sur ${nombre(bilan.jugees)} jugées, ${pourcentage(t)}`}>
      <svg viewBox="0 0 36 36" width={taille} height={taille} aria-hidden="true">
        <circle cx="18" cy="18" r={r} className="anneau-fond" />
        <circle cx="18" cy="18" r={r} className="anneau-valeur" strokeDasharray={`${t * circonference} ${circonference}`} transform="rotate(-90 18 18)" />
      </svg>
      <span className="anneau-texte">
        <span className="anneau-pourcentage">{bilan.jugees > 0 ? pourcentage(t) : "–"}</span>
        <span className="anneau-detail">
          {nombre(bilan.reussies)}/{nombre(bilan.jugees)}
        </span>
      </span>
    </div>
  );
}

// Une barre par groupe (type, profil, catégorie) : la part réussie, et les comptes
export function BarresBilan({ groupes, libelle = (k: string) => k }: { groupes: Record<string, Bilan>; libelle?: (k: string) => string }) {
  const entrees = Object.entries(groupes).sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]));
  if (entrees.length === 0) return <p className="muet petit">Aucune question.</p>;
  return (
    <ul className="barres-bilan">
      {entrees.map(([cle, b]) => {
        const t = taux(b);
        return (
          <li key={cle}>
            <span className="barres-bilan-libelle une-ligne" title={libelle(cle)}>
              {libelle(cle)}
            </span>
            <span className="barres-bilan-piste" role="img" aria-label={`${libelle(cle)}\u00a0: ${nombre(b.reussies)} réussies sur ${nombre(b.jugees)} jugées`}>
              <span className="barres-bilan-reussies" style={{ width: `${b.total > 0 ? (b.reussies / b.total) * 100 : 0}%` }} />
              <span className="barres-bilan-echouees" style={{ width: `${b.total > 0 ? ((b.jugees - b.reussies) / b.total) * 100 : 0}%` }} />
            </span>
            <span className="barres-bilan-valeur">
              {nombre(b.reussies)}/{nombre(b.jugees)}
              {b.jugees < b.total && <span className="muet"> ({nombre(b.total - b.jugees)} non jugée{b.total - b.jugees >= 2 ? "s" : ""})</span>}
            </span>
            <span className="barres-bilan-taux">{b.jugees > 0 ? pourcentage(t) : "–"}</span>
          </li>
        );
      })}
    </ul>
  );
}

export type Statut = "reussie" | "echouee" | "non-jugee" | "erreur";

export const statutDe = (reussie: boolean | null, erreur: boolean): Statut => (erreur ? "erreur" : reussie === true ? "reussie" : reussie === false ? "echouee" : "non-jugee");

const STATUTS: Record<Statut, { ton: Ton; libelle: string }> = {
  reussie: { ton: "ok", libelle: "réussie" },
  echouee: { ton: "erreur", libelle: "échouée" },
  "non-jugee": { ton: "neutre", libelle: "non jugée" },
  erreur: { ton: "alerte", libelle: "en erreur" },
};

export function PastilleStatut({ statut }: { statut: Statut }) {
  const s = STATUTS[statut];
  return (
    <Pastille ton={s.ton} icone={statut === "reussie" ? "coche" : statut === "echouee" ? "croix" : statut === "erreur" ? "alerte" : undefined}>
      {s.libelle}
    </Pastille>
  );
}

// Un critère du verdict, en petite pastille : ✓, ✗, ou ? (non jugé)
export function PuceCritere({ critere, ok }: { critere: string; ok: boolean | null }) {
  const nom = CRITERES[critere] ?? critere;
  const etat = ok === true ? "ok" : ok === false ? "ko" : "inconnu";
  return (
    <span className={`puce-critere ${etat}`} title={`${nom}\u00a0: ${ok === true ? "satisfait" : ok === false ? "non satisfait" : "non jugé"}`}>
      {ok === true ? "✓" : ok === false ? "✗" : "?"} {nom}
    </span>
  );
}

export function PastilleJeu({ jeu }: { jeu: string }) {
  return jeu === "cache" ? (
    <Pastille ton="alerte" icone="cadenas" titre="Le jeu caché&nbsp;: on n'en lit que les scores">
      jeu caché
    </Pastille>
  ) : (
    <Pastille ton="info">jeu de travail</Pastille>
  );
}
