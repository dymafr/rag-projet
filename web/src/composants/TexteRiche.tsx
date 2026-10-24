// Une réponse de Rhéa, mise en forme : l'arbre de markdown.ts rendu en éléments React. Chaque source citée devient une
// pastille qui ouvre son passage ; une source inventée (rendue par aucun outil) est signalée
import { memo, useMemo, type ReactNode } from "react";
import { lireMarkdown, type Bloc, type EnLigne } from "../outils/markdown.ts";
import { PastillePassage } from "./PastillePassage.tsx";

type Sources = { inventees?: ReadonlySet<string>; replis?: ReadonlyMap<string, { titre?: string; texte?: string; score?: number }> };

export const TexteRiche = memo(function TexteRiche({ texte, sources = {} }: { texte: string; sources?: Sources }) {
  const blocs = useMemo(() => lireMarkdown(texte), [texte]);
  return <div className="texte-riche">{blocs.map((b, i) => rendreBloc(b, i, sources))}</div>;
});

function rendreBloc(bloc: Bloc, cle: number, sources: Sources): ReactNode {
  switch (bloc.type) {
    case "paragraphe":
      return <p key={cle}>{rendreEnLigne(bloc.enfants, sources)}</p>;
    case "titre":
      return (
        <p key={cle} className={`md-titre md-titre-${Math.min(bloc.niveau, 3)}`}>
          {rendreEnLigne(bloc.enfants, sources)}
        </p>
      );
    case "liste": {
      const elements = bloc.elements.map((blocs, i) => (
        <li key={i}>
          {blocs.length === 1 && blocs[0].type === "paragraphe" ? rendreEnLigne(blocs[0].enfants, sources) : blocs.map((b, j) => rendreBloc(b, j, sources))}
        </li>
      ));
      return bloc.ordonnee ? (
        <ol key={cle} start={bloc.debut}>
          {elements}
        </ol>
      ) : (
        <ul key={cle}>{elements}</ul>
      );
    }
    case "code":
      return (
        <pre key={cle} className="md-code">
          <code>{bloc.texte}</code>
        </pre>
      );
    case "tableau":
      return (
        <div key={cle} className="md-tableau">
          <table>
            <thead>
              <tr>
                {bloc.entete.map((c, i) => (
                  <th key={i} scope="col">
                    {rendreEnLigne(c, sources)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bloc.lignes.map((ligne, i) => (
                <tr key={i}>
                  {ligne.map((c, j) => (
                    <td key={j}>{rendreEnLigne(c, sources)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "bloc-cite":
      return <blockquote key={cle}>{bloc.blocs.map((b, i) => rendreBloc(b, i, sources))}</blockquote>;
    case "separateur":
      return <hr key={cle} />;
  }
}

function rendreEnLigne(enfants: EnLigne[], sources: Sources): ReactNode[] {
  return enfants.map((e, i) => {
    switch (e.type) {
      case "texte":
        return e.texte;
      case "gras":
        return <strong key={i}>{rendreEnLigne(e.enfants, sources)}</strong>;
      case "italique":
        return <em key={i}>{rendreEnLigne(e.enfants, sources)}</em>;
      case "code":
        return <code key={i}>{e.texte}</code>;
      case "citation":
        return <PastillePassage key={i} id={e.id} inventee={sources.inventees?.has(e.id)} repli={sources.replis?.get(e.id)} compacte />;
      case "lien":
        return (
          <span key={i} className="md-lien" title={e.url}>
            {e.texte} <span className="mono muet">({e.url})</span>
          </span>
        );
      case "saut":
        return <br key={i} />;
    }
  });
}
