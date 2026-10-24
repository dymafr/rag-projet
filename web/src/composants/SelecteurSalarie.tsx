// Le salarié connecté : un sélecteur avec recherche (nom, matricule, profil, site, service). Tout ce que montre
// l'interface passe par ses droits : changer de salarié change ce qu'on voit. Sans le mode inspection, l'annuaire
// n'existe pas : on saisit un matricule
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { libelleSalarie, MOTIF_MATRICULE, useSession } from "../contextes/session.tsx";
import { defilerJusqua } from "../outils/defilement.ts";
import type { FicheSalarie } from "../types.ts";
import { Icone } from "./Icone.tsx";

const ORDRE_DES_PROFILS = ["salarie", "manager", "rh"];
const GROUPES: Record<string, string> = { salarie: "Salariés", manager: "Managers", rh: "Service RH" };

const sansAccents = (t: string) =>
  t
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

const initiales = (s: FicheSalarie) => `${s.prenom[0] ?? ""}${s.nom[0] ?? ""}`.toUpperCase();

export function SelecteurSalarie() {
  const { matricule, changerMatricule, salaries, fiche } = useSession();
  const [ouvert, setOuvert] = useState(false);
  const racine = useRef<HTMLDivElement>(null);
  const bouton = useRef<HTMLButtonElement>(null);

  // Un clic ailleurs ferme la liste
  useEffect(() => {
    if (!ouvert) return;
    const fermer = (e: PointerEvent) => {
      if (racine.current && !racine.current.contains(e.target as Node)) setOuvert(false);
    };
    document.addEventListener("pointerdown", fermer);
    return () => document.removeEventListener("pointerdown", fermer);
  }, [ouvert]);

  const fermer = (rendreLeFocus: boolean) => {
    setOuvert(false);
    if (rendreLeFocus) bouton.current?.focus();
  };

  return (
    <div className="selecteur-salarie" ref={racine}>
      <button
        ref={bouton}
        type="button"
        className="selecteur-salarie-bouton"
        aria-haspopup="dialog"
        aria-expanded={ouvert}
        onClick={() => setOuvert((o) => !o)}
        title="Changer de salarié connecté"
      >
        <span className={`avatar profil-${fiche?.role ?? "inconnu"}`} aria-hidden="true">
          {fiche ? initiales(fiche) : <Icone nom="utilisateur" taille={14} />}
        </span>
        <span className="selecteur-salarie-textes">
          <span className="selecteur-salarie-surtitre">Connecté en tant que</span>
          <span className="selecteur-salarie-nom une-ligne">{fiche ? libelleSalarie(fiche) : salaries.etat === "chargement" ? "…" : matricule}</span>
        </span>
        <span className="mono muet petit">{matricule}</span>
        <Icone nom="chevron-bas" taille={14} />
      </button>
      {ouvert &&
        (salaries.etat === "ok" ? (
          <ListeSalaries
            salaries={salaries.donnees}
            matricule={matricule}
            onChoisir={(m) => {
              changerMatricule(m);
              fermer(true);
            }}
            onFermer={() => fermer(true)}
          />
        ) : (
          <SaisieMatricule
            matricule={matricule}
            message={salaries.etat === "erreur" ? salaries.erreur.message : "Le serveur tourne sans le mode inspection\u00a0: l'annuaire n'est pas lisible. Saisissez un matricule."}
            onChoisir={(m) => {
              changerMatricule(m);
              fermer(true);
            }}
            onFermer={() => fermer(true)}
          />
        ))}
    </div>
  );
}

function ListeSalaries({ salaries, matricule, onChoisir, onFermer }: { salaries: FicheSalarie[]; matricule: string; onChoisir: (m: string) => void; onFermer: () => void }) {
  const [filtre, setFiltre] = useState("");
  const idListe = useId();
  const liste = useRef<HTMLUListElement>(null);
  const tries = useMemo(
    () => [...salaries].sort((a, b) => ORDRE_DES_PROFILS.indexOf(a.role) - ORDRE_DES_PROFILS.indexOf(b.role) || a.nom.localeCompare(b.nom, "fr") || a.prenom.localeCompare(b.prenom, "fr")),
    [salaries],
  );
  const visibles = useMemo(() => {
    const mots = sansAccents(filtre).split(/\s+/).filter(Boolean);
    if (mots.length === 0) return tries;
    return tries.filter((s) => {
      const texte = sansAccents(`${s.prenom} ${s.nom} ${s.matricule} ${s.role} ${s.site} ${s.service} ${s.poste}`);
      return mots.every((m) => texte.includes(m));
    });
  }, [tries, filtre]);
  const [actif, setActif] = useState(() => Math.max(0, visibles.findIndex((s) => s.matricule === matricule)));
  const indexActif = Math.min(actif, visibles.length - 1);

  useEffect(() => {
    const option = liste.current?.querySelector<HTMLElement>(`[data-index="${indexActif}"]`);
    if (option) defilerJusqua(option, { seulementSiCache: true });
  }, [indexActif]);

  const surTouche = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") setActif(Math.min(visibles.length - 1, indexActif + 1));
    else if (e.key === "ArrowUp") setActif(Math.max(0, indexActif - 1));
    else if (e.key === "Home" && e.ctrlKey) setActif(0);
    else if (e.key === "End" && e.ctrlKey) setActif(visibles.length - 1);
    else if (e.key === "PageDown") setActif(Math.min(visibles.length - 1, indexActif + 8));
    else if (e.key === "PageUp") setActif(Math.max(0, indexActif - 8));
    else if (e.key === "Enter" && visibles[indexActif]) onChoisir(visibles[indexActif].matricule);
    else if (e.key === "Escape") onFermer();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  let groupe = "";
  return (
    <div className="popover selecteur-salarie-popover" role="dialog" aria-label="Choisir le salarié connecté">
      <div className="popover-recherche">
        <Icone nom="recherche" taille={14} />
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls={idListe}
          aria-autocomplete="list"
          aria-activedescendant={visibles[indexActif] ? `${idListe}-${visibles[indexActif].matricule}` : undefined}
          aria-label="Rechercher un salarié&nbsp;: nom, matricule, profil, site, service"
          placeholder="Nom, matricule, profil, site…"
          value={filtre}
          onChange={(e) => {
            setFiltre(e.target.value);
            setActif(0);
          }}
          onKeyDown={surTouche}
        />
        <span className="muet petit">{visibles.length}</span>
      </div>
      <ul className="popover-liste" role="listbox" id={idListe} ref={liste} aria-label="Salariés">
        {visibles.length === 0 && <li className="popover-vide">Aucun salarié ne correspond.</li>}
        {visibles.map((s, i) => {
          const titreGroupe = s.role !== groupe ? GROUPES[s.role] ?? s.role : null;
          groupe = s.role;
          return (
            <li key={s.matricule} role="presentation">
              {titreGroupe && (
                <div className="popover-groupe" aria-hidden="true">
                  {titreGroupe}
                </div>
              )}
              <div
                id={`${idListe}-${s.matricule}`}
                role="option"
                aria-selected={s.matricule === matricule}
                data-index={i}
                className={`option-salarie${i === indexActif ? " active" : ""}${s.matricule === matricule ? " choisie" : ""}`}
                onMouseMove={() => setActif(i)}
                onClick={() => onChoisir(s.matricule)}
              >
                <span className={`avatar petit profil-${s.role}`} aria-hidden="true">
                  {initiales(s)}
                </span>
                <span className="option-salarie-textes">
                  <span className="une-ligne">{libelleSalarie(s)}</span>
                  <span className="muet petit une-ligne">
                    {s.poste} · {s.service}
                  </span>
                </span>
                <span className="mono muet petit">{s.matricule}</span>
                {s.matricule === matricule && <Icone nom="coche" taille={14} />}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SaisieMatricule({ matricule, message, onChoisir, onFermer }: { matricule: string; message: string; onChoisir: (m: string) => void; onFermer: () => void }) {
  const [valeur, setValeur] = useState(matricule);
  const valide = MOTIF_MATRICULE.test(valeur);
  return (
    <form
      className="popover selecteur-salarie-popover saisie-matricule"
      aria-label="Saisir un matricule"
      onSubmit={(e) => {
        e.preventDefault();
        if (valide) onChoisir(valeur);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onFermer();
        }
      }}
    >
      <p className="muet petit">{message}</p>
      <label className="champ">
        <span className="champ-libelle">Matricule</span>
        <input autoFocus className="mono" value={valeur} onChange={(e) => setValeur(e.target.value.toUpperCase())} pattern="K\d{4}" maxLength={5} aria-invalid={!valide} />
      </label>
      <button type="submit" className="bouton bouton-primaire" disabled={!valide}>
        Se connecter avec ce matricule
      </button>
    </form>
  );
}
