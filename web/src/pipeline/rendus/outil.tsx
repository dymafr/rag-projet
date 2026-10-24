// Un appel d'outil : ses arguments, son statut, la cause d'une erreur, les passages qu'il a rendus et le texte que le LLM
// lira. Les appels faits par le code (d'office, de secours) le disent
import { BlocTexte } from "../../composants/BlocTexte.tsx";
import { Definitions, Pastille, type Ton } from "../../composants/elements.tsx";
import { Icone } from "../../composants/Icone.tsx";
import { booleen, nombre, objet, passagesBrefs, texte } from "../../outils/lecture.ts";
import { JsonLisible, Section, TableauPassages, type ProprietesRendu } from "./communs.tsx";

const STATUTS: Record<string, { ton: Ton; libelle: string }> = {
  ok: { ton: "ok", libelle: "réussi" },
  erreur: { ton: "erreur", libelle: "en erreur" },
  refusé: { ton: "alerte", libelle: "refusé" },
  limite: { ton: "alerte", libelle: "limite atteinte" },
};

const APPELS_DU_CODE: Record<string, string> = {
  "organigramme-d-office": "appel d'office\u00a0: le code consulte la fiche du salarié connecté avant le premier tour",
  "recherche-d-office": "recherche d'office\u00a0: le code cherche avant le premier tour",
  "recherche-de-secours": "recherche de secours\u00a0: le LLM a répondu sans chercher, le code cherche à sa place",
};

export function RenduOutil({ etape }: ProprietesRendu) {
  const appel = objet(etape.details, "appel");
  const statut = texte(etape.details, "statut") ?? etape.statut;
  const cause = texte(etape.details, "cause");
  const passages = passagesBrefs(etape.details, "passages");
  const rendu = texte(etape.details, "texte") ?? "";
  const idAppel = texte(appel, "id") ?? "";
  const s = STATUTS[statut] ?? { ton: "neutre" as Ton, libelle: statut };
  return (
    <>
      <div className="rendu-entete-ligne">
        <Pastille ton="outil" icone="outil" mono>
          {texte(appel, "nom") ?? "outil"}
        </Pastille>
        <Pastille ton={s.ton}>{s.libelle}</Pastille>
        <Pastille>tour {nombre(etape.details, "tour") ?? "?"}</Pastille>
      </div>
      {APPELS_DU_CODE[idAppel] && (
        <p className="note-rendu">
          <Icone nom="info" taille={14} /> {APPELS_DU_CODE[idAppel]}.
        </p>
      )}
      {booleen(etape.details, "nonFiable") && (
        <p className="note-rendu alerte" role="note">
          <Icone nom="alerte" taille={14} /> Texte écrit par un tiers (un ticket)&nbsp;: après lui, plus aucune action pour cette question (règle de deux, chapitre 13).
        </p>
      )}
      {cause && (
        <Section titre="Cause de l'erreur" note="gardée hors du prompt&nbsp;: le LLM ne reçoit qu'un message général">
          <BlocTexte texte={cause} />
        </Section>
      )}
      <Section titre="Arguments">
        <Definitions lignes={[["Identifiant de l'appel", <span className="mono">{idAppel || "–"}</span>]]} />
        <JsonLisible valeur={appel?.arguments ?? null} />
      </Section>
      {passages.length > 0 && (
        <Section titre="Passages rendus" note="dans l'ordre où le LLM les lit&#8239;; score&nbsp;: cosinus avec la requête">
          <TableauPassages passages={passages} ton="outil" />
        </Section>
      )}
      <Section titre="Texte rendu au LLM">
        <BlocTexte texte={rendu} avecPassages hauteurMax={320} />
      </Section>
    </>
  );
}
