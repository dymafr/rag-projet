// Le tiroir d'un passage : son texte entier et ses métadonnées, relus sur le serveur avec les droits du salarié connecté.
// Un passage réservé et un passage qui n'existe pas donnent la même réponse : le tiroir ne dit jamais lequel des deux
import { cheminDuPassage } from "../api/client.ts";
import { useRequete } from "../api/requete.ts";
import { useServeur } from "../contextes/serveur.tsx";
import { useSession } from "../contextes/session.tsx";
import { date, nombre, score as formaterScore, tokens } from "../outils/format.ts";
import { cheminDuDocument, Lien } from "../routeur.tsx";
import type { PassageIndexe } from "../types.ts";
import { Dialogue } from "./Dialogue.tsx";
import { BoutonCopier, BoutonIcone, Definitions, EtatErreur, EtatVide, Squelette } from "./elements.tsx";
import { PastilleAcces } from "./PastilleAcces.tsx";

export type DemandePassage = { id: string; repli?: { titre?: string; texte?: string; score?: number } };

export function TiroirPassage({ demande, onFermer }: { demande: DemandePassage; onFermer: () => void }) {
  const serveur = useServeur();
  const { matricule } = useSession();
  const lu = useRequete<PassageIndexe>(serveur.inspection ? cheminDuPassage(demande.id) : null, matricule);
  const numero = demande.id.split("#")[1];
  const repli = demande.repli;

  return (
    <Dialogue onFermer={onFermer} className="tiroir" titreId="tiroir-titre">
      <header className="tiroir-entete">
        <div className="tiroir-titres">
          <p className="surtitre">Passage {numero ? `n° ${numero}` : ""}</p>
          <h2 id="tiroir-titre" className="mono tiroir-id">
            {demande.id}
          </h2>
        </div>
        <div className="tiroir-actions">
          <BoutonCopier texte={demande.id} libelle="Copier l'identifiant" />
          <BoutonIcone icone="croix" libelle="Fermer (Échap)" onClick={onFermer} />
        </div>
      </header>
      <div className="tiroir-corps">
        {serveur.inspection === false || serveur.etat === "injoignable" ? (
          repli?.texte ? (
            <TexteDuRepli repli={repli} />
          ) : (
            <EtatVide icone="cadenas" titre="Passage indisponible">
              Le serveur tourne sans le mode inspection&nbsp;: l'interface ne peut pas relire les passages.
            </EtatVide>
          )
        ) : lu.etat === "chargement" ? (
          <div className="tiroir-squelette" role="status" aria-label="Chargement du passage">
            <Squelette largeur="60%" hauteur={18} />
            <Squelette largeur="40%" />
            <Squelette largeur="100%" hauteur={120} />
          </div>
        ) : lu.etat === "erreur" ? (
          lu.erreur.statut === 404 ? (
            <>
              <EtatVide icone="cadenas" titre="Passage introuvable pour ce profil">
                Ce passage n'est pas dans l'index, ou le salarié connecté n'a pas le droit de le lire&nbsp;: la réponse est la même
                dans les deux cas, pour ne rien laisser deviner d'un document réservé.
              </EtatVide>
              {repli?.texte && <TexteDuRepli repli={repli} />}
            </>
          ) : (
            <EtatErreur message={lu.erreur.message} reessayer={lu.recharger} />
          )
        ) : (
          <>
            {lu.donnees.titres.length > 0 && (
              <p className="tiroir-chemin" aria-label="Titres">
                {lu.donnees.titres.map((t, i) => (
                  <span key={i}>{t}</span>
                ))}
              </p>
            )}
            <Definitions
              lignes={[
                [
                  "Document",
                  <Lien vers={`${cheminDuDocument(lu.donnees.document)}#${encodeURIComponent(demande.id)}`} onClick={onFermer} className="mono">
                    {lu.donnees.document}
                  </Lien>,
                ],
                ["Type", lu.donnees.type],
                ["Niveau d'accès", <PastilleAcces acces={lu.donnees.acces} />],
                ["En vigueur", <>{date(lu.donnees.date_effet)}{lu.donnees.date_fin ? ` → ${date(lu.donnees.date_fin)}` : ", sans date de fin"}</>],
                ["Taille", tokens(lu.donnees.taille)],
                ...(repli?.score !== undefined ? ([["Score", formaterScore(repli.score)]] as [string, string][]) : []),
              ]}
            />
            <div className="bloc-titre">
              <h3>Texte</h3>
              <span className="muet petit">{nombre(lu.donnees.texte.length)} caractères</span>
              <BoutonCopier texte={lu.donnees.texte} libelle="Copier le texte" avecTexte />
            </div>
            <div className="texte-passage">{lu.donnees.texte}</div>
          </>
        )}
      </div>
    </Dialogue>
  );
}

function TexteDuRepli({ repli }: { repli: NonNullable<DemandePassage["repli"]> }) {
  return (
    <>
      <div className="bloc-titre">
        <h3>Texte rendu par l'outil</h3>
        {repli.texte && <BoutonCopier texte={repli.texte} libelle="Copier le texte" avecTexte />}
      </div>
      {repli.titre && <p className="tiroir-chemin">{repli.titre}</p>}
      <div className="texte-passage">{repli.texte}</div>
    </>
  );
}
