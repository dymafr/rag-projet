// L'interface d'inspection de Rhéa : la coquille, les vues selon l'adresse, et les raccourcis clavier de toute la page
import { Component, useEffect, useState, type ReactNode } from "react";
import { BarreDuHaut, Navigation, VUES } from "./composants/Coquille.tsx";
import { Dialogue } from "./composants/Dialogue.tsx";
import { BoutonIcone, EtatErreur, Raccourci } from "./composants/elements.tsx";
import { FournisseurConversation } from "./contextes/conversation.tsx";
import { FournisseurPassage } from "./contextes/passage.tsx";
import { FournisseurServeur } from "./contextes/serveur.tsx";
import { FournisseurSession } from "./contextes/session.tsx";
import { naviguer, useRoute, type Route } from "./routeur.tsx";
import { VueConfiguration } from "./vues/VueConfiguration.tsx";
import { VueConversation } from "./vues/VueConversation.tsx";
import { VueDocument } from "./vues/VueDocument.tsx";
import { VueEvaluations } from "./vues/VueEvaluations.tsx";
import { VueExecution } from "./vues/VueExecution.tsx";
import { VueIndex } from "./vues/VueIndex.tsx";
import { VueIntrouvable } from "./vues/VueIntrouvable.tsx";
import { VueQuestion } from "./vues/VueQuestion.tsx";
import { VueObservabilite } from "./vues/VueObservabilite.tsx";
import { VueRecherche } from "./vues/VueRecherche.tsx";

const TITRES: Record<Route["vue"], string> = {
  conversation: "Conversation",
  recherche: "Recherche",
  index: "Index",
  document: "Document",
  evaluations: "Évaluations",
  execution: "Évaluation",
  question: "Question",
  observabilite: "Observabilité",
  configuration: "Configuration",
  introuvable: "Page introuvable",
};

function titreDe(route: Route): string {
  if (route.vue === "document") return `${route.document} · Index`;
  if (route.vue === "execution") return `${route.nom} · Évaluations`;
  if (route.vue === "question") return `${route.id} · ${route.nom}`;
  return TITRES[route.vue];
}

function Vue({ route }: { route: Route }) {
  switch (route.vue) {
    case "conversation":
      return <VueConversation />;
    case "recherche":
      return <VueRecherche />;
    case "index":
      return <VueIndex />;
    case "document":
      return <VueDocument document={route.document} />;
    case "evaluations":
      return <VueEvaluations />;
    case "execution":
      return <VueExecution nom={route.nom} />;
    case "question":
      return <VueQuestion nom={route.nom} id={route.id} />;
    case "observabilite":
      return <VueObservabilite />;
    case "configuration":
      return <VueConfiguration />;
    case "introuvable":
      return <VueIntrouvable chemin={route.chemin} />;
  }
}

const dansUnChamp = (cible: EventTarget | null) =>
  cible instanceof HTMLElement && (cible.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(cible.tagName));

export function App() {
  const route = useRoute();
  const [aide, setAide] = useState(false);

  useEffect(() => {
    document.title = `${titreDe(route)} · Rhéa`;
  }, [route]);

  // Les raccourcis de toute la page : ? (l'aide), / (le champ principal de la vue), Alt+1 à Alt+6 (les vues)
  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.altKey && !e.ctrlKey && !e.metaKey && /^Digit[1-6]$/.test(e.code)) {
        e.preventDefault();
        naviguer(VUES[Number(e.code.slice(5)) - 1].vers);
        return;
      }
      if (dansUnChamp(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "?") {
        e.preventDefault();
        setAide(true);
      } else if (e.key === "/") {
        const champ = document.querySelector<HTMLElement>("[data-champ-principal]");
        if (champ) {
          e.preventDefault();
          champ.focus();
        }
      }
    };
    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, []);

  return (
    <div className="coquille">
      <a className="lien-evitement" href="#principal">
        Aller au contenu
      </a>
      <BarreDuHaut onAide={() => setAide(true)} />
      <Navigation route={route} />
      <main className="principal" id="principal" tabIndex={-1}>
        <GardeVue key={location.pathname}>
          <Vue route={route} />
        </GardeVue>
      </main>
      {aide && <AideClavier onFermer={() => setAide(false)} />}
    </div>
  );
}

// Une vue qui plante (une donnée inattendue) n'emporte pas toute la page : la coquille reste, avec un message
class GardeVue extends Component<{ children: ReactNode }, { erreur: string | null }> {
  state: { erreur: string | null } = { erreur: null };

  static getDerivedStateFromError(erreur: unknown) {
    return { erreur: erreur instanceof Error ? erreur.message : String(erreur) };
  }

  render() {
    if (this.state.erreur === null) return this.props.children;
    return (
      <div className="vue-page">
        <EtatErreur titre="Cette vue n'a pas pu s'afficher" message={`Une donnée inattendue l'en a empêchée (${this.state.erreur}). Les autres vues restent utilisables.`} reessayer={() => this.setState({ erreur: null })} />
      </div>
    );
  }
}

const RACCOURCIS: [string[], string][] = [
  [["Ctrl", "Entrée"], "Envoyer la question, lancer la recherche"],
  [["/"], "Aller au champ principal de la vue"],
  [["↑", "↓"], "Passer d'une étape à l'autre dans le pipeline"],
  [["←", "→"], "Replier, déplier une étape qui en contient d'autres"],
  [["Entrée"], "Ouvrir le détail de l'étape"],
  [["Échap"], "Fermer un détail, un passage, une liste"],
  [["Alt", "1…6"], "Conversation, Recherche, Index, Évaluations, Observabilité, Configuration"],
  [["?"], "Afficher cette aide"],
];

function AideClavier({ onFermer }: { onFermer: () => void }) {
  return (
    <Dialogue onFermer={onFermer} className="dialogue-aide" titreId="aide-titre">
      <header className="dialogue-entete">
        <h2 id="aide-titre">Raccourcis clavier</h2>
        <BoutonIcone icone="croix" libelle="Fermer (Échap)" onClick={onFermer} />
      </header>
      <dl className="liste-raccourcis">
        {RACCOURCIS.map(([touches, action]) => (
          <div key={action} className="raccourci-ligne">
            <dt>
              <Raccourci touches={touches} />
            </dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
      <p className="muet petit">Tout se fait au clavier&nbsp;: Tab parcourt la page, et le focus reste toujours visible.</p>
    </Dialogue>
  );
}

export function Racine() {
  return (
    <FournisseurServeur>
      <FournisseurSession>
        <FournisseurPassage>
          <FournisseurConversation>
            <App />
          </FournisseurConversation>
        </FournisseurPassage>
      </FournisseurSession>
    </FournisseurServeur>
  );
}
