// Un document de l'index : ses métadonnées et ses passages, dans l'ordre (texte entier, taille en tokens). Un document
// réservé et un document qui n'existe pas donnent la même réponse : « introuvable pour ce profil »
import { useEffect, useMemo } from "react";
import { useRequete } from "../api/requete.ts";
import { BoutonCopier, Carte, Definitions, EtatErreur, EtatVide, Pastille, SqueletteLignes } from "../composants/elements.tsx";
import { Icone } from "../composants/Icone.tsx";
import { PastilleAcces } from "../composants/PastilleAcces.tsx";
import { useServeur } from "../contextes/serveur.tsx";
import { useSession } from "../contextes/session.tsx";
import { date as formaterDate, nombre, nomsDesSites, pluriel, tokens as formaterTokens } from "../outils/format.ts";
import { defilerJusqua } from "../outils/defilement.ts";
import { Lien } from "../routeur.tsx";
import type { DocumentIndexe, PassageIndexe } from "../types.ts";

export function VueDocument({ document }: { document: string }) {
  const serveur = useServeur();
  const { matricule, fiche } = useSession();
  const passages = useRequete<PassageIndexe[]>(serveur.inspection ? `/api/documents/${encodeURIComponent(document)}` : null, matricule);
  const documents = useRequete<DocumentIndexe[]>(serveur.inspection ? "/api/documents" : null, matricule);
  const meta = documents.etat === "ok" ? documents.donnees.find((d) => d.document === document) : undefined;

  // L'ancre d'un passage (#POL-TT-02%233) : on y descend une fois les passages affichés
  useEffect(() => {
    if (passages.etat !== "ok" || !location.hash) return;
    const id = decodeURIComponent(location.hash.slice(1));
    const cible = window.document.querySelector<HTMLElement>(`[data-passage="${CSS.escape(id)}"]`);
    if (!cible) return;
    defilerJusqua(cible);
    cible.classList.add("passage-cible");
  }, [passages.etat]);

  const total = useMemo(() => (passages.etat === "ok" ? passages.donnees.reduce((s, p) => s + p.taille, 0) : 0), [passages]);

  if (serveur.inspection === false) {
    return (
      <div className="vue-page">
        <EtatVide icone="cadenas" titre="Inspection désactivée">
          Le serveur tourne sans le mode inspection&nbsp;: l'index n'est pas lisible depuis l'interface.
        </EtatVide>
      </div>
    );
  }

  return (
    <div className="vue-page">
      <div className="vue-page-contenu">
        <nav className="fil-d-ariane" aria-label="Fil d'Ariane">
          <Lien vers="/index">Index</Lien>
          <Icone nom="chevron-droite" taille={12} />
          <span className="mono">{document}</span>
        </nav>
        {passages.etat === "chargement" ? (
          <SqueletteLignes lignes={10} libelle="Chargement du document" />
        ) : passages.etat === "erreur" ? (
          passages.erreur.statut === 404 ? (
            <EtatVide icone="cadenas" titre="Document introuvable pour ce profil" action={<Lien vers="/index">Revenir à l'index</Lien>}>
              <span className="mono">{document}</span> n'existe pas, ou {fiche ? `le profil ${fiche.role}` : "le salarié connecté"} n'a pas le droit de le lire&nbsp;:
              la réponse est la même dans les deux cas.
            </EtatVide>
          ) : (
            <EtatErreur message={passages.erreur.message} reessayer={passages.recharger} />
          )
        ) : (
          <>
            <header className="entete-document carte">
              <div className="entete-document-titres">
                <p className="mono surtitre-document">{document}</p>
                <h1>{meta?.titre ?? passages.donnees[0]?.titres[0] ?? document}</h1>
                <div className="pastilles-ligne">
                  <Pastille icone="document">{passages.donnees[0]?.type ?? meta?.type}</Pastille>
                  <PastilleAcces acces={passages.donnees[0]?.acces ?? meta?.acces ?? "tous"} />
                  <Pastille>{pluriel(passages.donnees.length, "passage")}</Pastille>
                  <Pastille>{formaterTokens(total)}</Pastille>
                </div>
              </div>
              <Definitions
                lignes={[
                  ["En vigueur", <>{formaterDate(passages.donnees[0]?.date_effet ?? meta?.date_effet ?? "")}{(passages.donnees[0]?.date_fin ?? meta?.date_fin) ? ` → ${formaterDate(passages.donnees[0]?.date_fin ?? meta?.date_fin ?? "")}` : ", sans date de fin"}</>],
                  ["Langue", meta ? <span className="mono">{meta.langue}</span> : "–"],
                  ["Sites", meta ? nomsDesSites(meta.sites) : "–"],
                ]}
              />
            </header>
            <div className="document-corps">
              <nav className="sommaire carte" aria-label="Passages du document">
                <p className="surtitre">Passages</p>
                <ol>
                  {passages.donnees.map((p) => (
                    <li key={p.id}>
                      <a href={`#${encodeURIComponent(p.id)}`} onClick={(e) => {
                        e.preventDefault();
                        history.replaceState(null, "", `#${encodeURIComponent(p.id)}`);
                        const cible = window.document.querySelector<HTMLElement>(`[data-passage="${CSS.escape(p.id)}"]`);
                        if (cible) defilerJusqua(cible, { doux: true });
                      }}>
                        <span className="mono">#{p.id.split("#")[1]}</span>
                        <span className="une-ligne">{p.titres.at(-1) ?? p.id}</span>
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
              <ol className="passages-document">
                {passages.donnees.map((p) => (
                  <li key={p.id} data-passage={p.id}>
                    <Carte
                      titre={<span className="mono">{p.id}</span>}
                      actions={
                        <>
                          <span className="muet petit">{formaterTokens(p.taille)}</span>
                          <BoutonCopier texte={p.texte} libelle={`Copier le texte de ${p.id}`} />
                        </>
                      }
                    >
                      {p.titres.length > 0 && (
                        <p className="tiroir-chemin">
                          {p.titres.map((t, i) => (
                            <span key={i}>{t}</span>
                          ))}
                        </p>
                      )}
                      <div className="texte-passage">{p.texte}</div>
                      {(p.date_effet !== passages.donnees[0]?.date_effet || p.acces !== passages.donnees[0]?.acces) && (
                        <p className="muet petit">
                          {p.acces} · en vigueur le {formaterDate(p.date_effet)}
                          {p.date_fin ? ` → ${formaterDate(p.date_fin)}` : ""}
                        </p>
                      )}
                    </Carte>
                  </li>
                ))}
              </ol>
            </div>
            <p className="muet petit">{nombre(passages.donnees.length)} passages, relus avec les droits de {fiche ? `${fiche.prenom} ${fiche.nom}` : matricule}.</p>
          </>
        )}
      </div>
    </div>
  );
}
