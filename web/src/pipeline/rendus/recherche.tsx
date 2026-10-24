// Les étapes de la recherche : le vecteur de la requête, la recherche vectorielle et plein texte, les similarités
// recalculées, le reclassement, la diversité, la fusion de plusieurs requêtes, la condensation et la transformation de
// la question, la recherche de secours
import { BlocTexte } from "../../composants/BlocTexte.tsx";
import { BarreScore, Definitions, Pastille } from "../../composants/elements.tsx";
import { Icone } from "../../composants/Icone.tsx";
import { PastillePassage } from "../../composants/PastillePassage.tsx";
import { TexteRiche } from "../../composants/TexteRiche.tsx";
import { decimal, nombre, pluriel } from "../../outils/format.ts";
import { estObjet, liste, nombre as lireNombre, objet, passageBref, passagesBrefs, texte, textes } from "../../outils/lecture.ts";
import { Filtres, Modele, Section, TableauPassages, type ProprietesRendu } from "./communs.tsx";

export function RenduEmbedding({ etape }: ProprietesRendu) {
  const contenus = textes(etape.details, "textes");
  const nature = texte(etape.details, "nature");
  return (
    <>
      <div className="rendu-entete-ligne">
        <Modele etape={etape} />
      </div>
      <Definitions
        lignes={[
          ["Dimensions", nombre(lireNombre(etape.details, "dimensions") ?? 0)],
          ["Nature", nature === "requete" ? "requête (la question à chercher)" : nature === "document" ? "passages (à indexer)" : (nature ?? "–")],
          ["Textes vectorisés", nombre(contenus.length)],
        ]}
      />
      <Section titre="Textes vectorisés" note="un vecteur par texte&#8239;; chaque vecteur est ramené à la longueur 1">
        <ol className="liste-textes">
          {contenus.map((t, i) => (
            <li key={i}>
              <BlocTexte texte={t} hauteurMax={120} proportionnel />
            </li>
          ))}
        </ol>
      </Section>
    </>
  );
}

export function RenduRechercheVectorielle({ etape }: ProprietesRendu) {
  const candidats = passagesBrefs(etape.details, "candidats");
  return (
    <>
      <Definitions
        lignes={[
          ["Candidats demandés", nombre(lireNombre(etape.details, "k") ?? candidats.length)],
          ["Filtres", <Filtres filtres={objet(etape.details, "filtres")} />],
        ]}
      />
      <Section titre="Candidats" note={`${pluriel(candidats.length, "passage")}, par similarité cosinus (de 0 à 1)`}>
        <TableauPassages passages={candidats} libelleScore="Cosinus" />
      </Section>
    </>
  );
}

export function RenduRecherchePleinTexte({ etape }: ProprietesRendu) {
  const candidats = passagesBrefs(etape.details, "candidats");
  return (
    <>
      <Definitions
        lignes={[
          ["Mots cherchés", <span className="mots-cherches">{texte(etape.details, "mots") ?? "–"}</span>],
          ["Candidats demandés", nombre(lireNombre(etape.details, "k") ?? candidats.length)],
          ["Filtres", <Filtres filtres={objet(etape.details, "filtres")} />],
        ]}
      />
      <Section titre="Candidats" note={`${pluriel(candidats.length, "passage")}\u202f; BM25 n'a pas de maximum\u00a0: la barre est relative au premier`}>
        <TableauPassages passages={candidats} echelle="relatif" libelleScore="BM25" ton="decision" />
      </Section>
    </>
  );
}

export function RenduSimilarites({ etape }: ProprietesRendu) {
  const passages = passagesBrefs(etape.details, "passages");
  return (
    <Section titre="Passages notés" note="le score devient la similarité cosinus avec la question&nbsp;: c'est lui que compare le seuil d'abstention">
      <TableauPassages passages={passages} libelleScore="Cosinus" />
    </Section>
  );
}

// Le reclassement : chaque candidat avec son rang avant, sa note, son rang après (ou écarté)
export function RenduReclassement({ etape }: ProprietesRendu) {
  const candidats = liste(etape.details, "candidats")
    .filter(estObjet)
    .flatMap((c) => {
      const p = passageBref(c);
      return p ? [{ ...p, avant: lireNombre(c, "rang_avant") ?? 0, note: lireNombre(c, "note") ?? 0, apres: lireNombre(c, "rang_apres") ?? null }] : [];
    })
    .sort((a, b) => (a.apres ?? Infinity) - (b.apres ?? Infinity) || a.avant - b.avant);
  const notes = candidats.map((c) => c.note);
  const min = Math.min(...notes, 0);
  const max = Math.max(...notes, 1e-9);
  return (
    <>
      <Definitions lignes={[["Reclasseur", <span className="mono">{texte(etape.details, "reclasseur") ?? "–"}</span>]]} />
      <Section titre="Avant et après" note={`${pluriel(candidats.filter((c) => c.apres !== null).length, "passage gardé", "passages gardés")} sur ${nombre(candidats.length)}`}>
        <div className="tableau-defilant">
          <table className="tableau tableau-passages">
            <thead>
              <tr>
                <th scope="col" className="col-rang">
                  Après
                </th>
                <th scope="col" className="col-rang">
                  Avant
                </th>
                <th scope="col" className="col-mouvement">
                  Mouvement
                </th>
                <th scope="col">Passage</th>
                <th scope="col" className="col-score">
                  Note du reclasseur
                </th>
              </tr>
            </thead>
            <tbody>
              {candidats.map((c) => (
                <tr key={c.id} className={c.apres === null ? "ligne-ecartee" : undefined}>
                  <td className="col-rang">{c.apres ?? "–"}</td>
                  <td className="col-rang muet">{c.avant}</td>
                  <td className="col-mouvement">
                    <Mouvement avant={c.avant} apres={c.apres} />
                  </td>
                  <td className="col-passage">
                    <PastillePassage id={c.id} repli={{ titre: c.titre, score: c.score }} />
                    {c.titre && <span className="passage-titre">{c.titre}</span>}
                  </td>
                  <td className="col-score">
                    <BarreScore rapport={(c.note - min) / (max - min || 1)} valeur={decimal(c.note, 3)} ton="llm" libelle={`Note de ${c.id}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}

export function Mouvement({ avant, apres }: { avant: number | null; apres: number | null }) {
  if (apres === null) return <span className="mouvement mouvement-ecarte">écarté</span>;
  if (avant === null) return <span className="mouvement mouvement-nouveau">nouveau</span>;
  const delta = avant - apres;
  if (delta === 0) return <span className="mouvement mouvement-stable" aria-label="même rang">=</span>;
  return (
    <span className={`mouvement ${delta > 0 ? "mouvement-monte" : "mouvement-descend"}`} aria-label={delta > 0 ? `monte de ${delta}` : `descend de ${-delta}`}>
      <Icone nom={delta > 0 ? "fleche-haut" : "fleche-bas"} taille={12} />
      {Math.abs(delta)}
    </span>
  );
}

export function RenduDiversite({ etape }: ProprietesRendu) {
  const gardes = passagesBrefs(etape.details, "gardes");
  return (
    <>
      <Definitions lignes={[["Lambda", <span className="mono">{decimal(lireNombre(etape.details, "lambda") ?? 0, 2)}</span>]]} />
      <p className="note-rendu">
        <Icone nom="info" taille={14} /> MMR choisit, à chaque pas, le passage le plus proche de la question et le moins proche de ceux déjà gardés&#8239;; lambda
        pèse la pertinence face à la différence.
      </p>
      <Section titre="Passages gardés" note="dans l'ordre du choix">
        <TableauPassages passages={gardes} libelleScore="Cosinus" />
      </Section>
    </>
  );
}

export function RenduFusionRequetes({ etape }: ProprietesRendu) {
  const requetes = textes(etape.details, "requetes");
  const candidats = passagesBrefs(etape.details, "candidats");
  return (
    <>
      <Section titre="Requêtes fusionnées" note={pluriel(requetes.length, "requête")}>
        <ol className="liste-requetes">
          {requetes.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ol>
      </Section>
      <Section titre="Candidats après la fusion" note="par rangs (RRF)">
        <TableauPassages passages={candidats} libelleScore="Cosinus" />
      </Section>
    </>
  );
}

export function RenduCondensation({ etape }: ProprietesRendu) {
  const question = texte(etape.details, "question") ?? "";
  const autonome = texte(etape.details, "autonome") ?? "";
  const echanges = lireNombre(etape.details, "echanges") ?? 0;
  const identique = question.trim() === autonome.trim();
  return (
    <>
      <div className="avant-apres">
        <div className="avant-apres-bloc">
          <span className="surtitre">Question posée</span>
          <p>{question}</p>
        </div>
        <span className="avant-apres-fleche" aria-hidden="true">
          <Icone nom="fleche-droite" taille={18} />
        </span>
        <div className="avant-apres-bloc mis-en-avant">
          <span className="surtitre">Question autonome</span>
          <p>{autonome}</p>
        </div>
      </div>
      <p className="note-rendu">
        <Icone nom="info" taille={14} />{" "}
        {identique
          ? "La question se comprend seule\u00a0: la recherche la cherche telle quelle."
          : `Réécrite à partir ${echanges >= 2 ? `des ${nombre(echanges)} derniers échanges` : "du dernier échange"}\u00a0: c'est elle que la recherche cherche.`}
      </p>
    </>
  );
}

export function RenduTransformation({ etape }: ProprietesRendu) {
  const requetes = textes(etape.details, "requetes");
  return (
    <>
      <Definitions lignes={[["Transformation", <Pastille ton="recherche">{texte(etape.details, "transformation") ?? "–"}</Pastille>]]} />
      <Section titre="Requêtes produites" note={pluriel(requetes.length, "requête")}>
        <ol className="liste-requetes">
          {requetes.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ol>
      </Section>
    </>
  );
}

export function RenduRechercheDeSecours({ etape }: ProprietesRendu) {
  const ecartee = texte(etape.details, "reponseEcartee") ?? "";
  return (
    <>
      <p className="note-rendu alerte">
        <Icone nom="boucle" taille={14} /> Au premier tour, le LLM a répondu sans appeler aucun outil. Sa réponse est écartée (ses tokens sont dépensés)&#8239;; le
        code cherche la question à sa place, et le LLM répond au tour suivant avec les passages.
      </p>
      <Section titre="Réponse écartée" note={`${nombre(ecartee.length)} caractères`}>
        <div className="texte-rendu ecarte">{ecartee ? <TexteRiche texte={ecartee} /> : <span className="muet">(vide)</span>}</div>
      </Section>
    </>
  );
}
