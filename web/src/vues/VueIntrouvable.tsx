// Une adresse que l'interface ne connaît pas
import { EtatVide } from "../composants/elements.tsx";
import { Lien } from "../routeur.tsx";

export function VueIntrouvable({ chemin }: { chemin: string }) {
  return (
    <div className="vue-page">
      <EtatVide icone="question" titre="Page introuvable" action={<Lien vers="/">Revenir à la conversation</Lien>}>
        L'adresse <span className="mono">{chemin}</span> ne correspond à aucune vue de l'interface.
      </EtatVide>
    </div>
  );
}
