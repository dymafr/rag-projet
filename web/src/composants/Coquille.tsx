// La coquille de l'interface : la barre du haut (salarié connecté, état du serveur et du modèle, thème) et la navigation
import { useTheme, type Theme } from "../contextes/theme.ts";
import { Lien, type Route } from "../routeur.tsx";
import { EtatDuServeur } from "./EtatDuServeur.tsx";
import { Icone, type NomIcone } from "./Icone.tsx";
import { SelecteurSalarie } from "./SelecteurSalarie.tsx";

export const VUES: { vue: Route["vue"][]; vers: string; libelle: string; icone: NomIcone }[] = [
  { vue: ["conversation"], vers: "/", libelle: "Conversation", icone: "conversation" },
  { vue: ["recherche"], vers: "/recherche", libelle: "Recherche", icone: "recherche" },
  { vue: ["index", "document"], vers: "/index", libelle: "Index", icone: "index" },
  { vue: ["evaluations", "execution", "question"], vers: "/evaluations", libelle: "Évaluations", icone: "evaluations" },
  { vue: ["observabilite"], vers: "/observabilite", libelle: "Observabilité", icone: "activite" },
  { vue: ["configuration"], vers: "/configuration", libelle: "Configuration", icone: "configuration" },
];

export function Navigation({ route }: { route: Route }) {
  return (
    <nav className="navigation" aria-label="Vues">
      <ul>
        {VUES.map((v, i) => {
          const actif = v.vue.includes(route.vue);
          return (
            <li key={v.vers}>
              <Lien vers={v.vers} className={`navigation-lien${actif ? " actif" : ""}`} aria-current={actif ? "page" : undefined} title={`${v.libelle} (Alt+${i + 1})`}>
                <Icone nom={v.icone} taille={18} />
                <span className="navigation-libelle">{v.libelle}</span>
              </Lien>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function BarreDuHaut({ onAide }: { onAide: () => void }) {
  return (
    <header className="barre-du-haut">
      <Lien vers="/" className="marque" aria-label="Rhéa, interface d'inspection&nbsp;: retour à la conversation">
        <span className="marque-logo" aria-hidden="true">
          R
        </span>
        <span className="marque-nom">Rhéa</span>
        <span className="marque-sous-titre">inspection</span>
      </Lien>
      <div className="barre-du-haut-centre">
        <SelecteurSalarie />
      </div>
      <div className="barre-du-haut-droite">
        <EtatDuServeur />
        <SelecteurTheme />
        <button type="button" className="bouton-icone" onClick={onAide} aria-label="Raccourcis clavier (?)" title="Raccourcis clavier (?)">
          <Icone nom="clavier" taille={18} />
        </button>
      </div>
    </header>
  );
}

const THEMES: { theme: Theme; libelle: string; icone: NomIcone }[] = [
  { theme: "clair", libelle: "Thème clair", icone: "soleil" },
  { theme: "sombre", libelle: "Thème sombre", icone: "lune" },
  { theme: "systeme", libelle: "Thème du système", icone: "ecran" },
];

function SelecteurTheme() {
  const [theme, choisir] = useTheme();
  return (
    <div className="selecteur-theme" role="radiogroup" aria-label="Thème">
      {THEMES.map((t) => (
        <button
          key={t.theme}
          type="button"
          role="radio"
          aria-checked={theme === t.theme}
          aria-label={t.libelle}
          title={t.libelle}
          tabIndex={theme === t.theme ? 0 : -1}
          className={theme === t.theme ? "actif" : undefined}
          onClick={() => choisir(t.theme)}
          onKeyDown={(e) => {
            const i = THEMES.findIndex((x) => x.theme === theme);
            const pas = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
            if (!pas) return;
            e.preventDefault();
            const suivant = THEMES[(i + pas + THEMES.length) % THEMES.length];
            choisir(suivant.theme);
            const parent = e.currentTarget.parentElement;
            requestAnimationFrame(() => parent?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
          }}
        >
          <Icone nom={t.icone} taille={15} />
        </button>
      ))}
    </div>
  );
}
