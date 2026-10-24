// Le rendu de chaque étape, par son nom stable (trace.ts). Ajouter un rendu : écrire un composant qui reçoit l'étape et
// son contexte (ProprietesRendu), puis l'ajouter à RENDUS. Une étape sans rendu a le rendu générique : son résumé, ses
// tokens s'il y en a, et l'arbre de son détail
import type { ReactNode } from "react";
import { ArbreJson } from "../../composants/ArbreJson.tsx";
import { JetonsLlm, Modele, Section, type ProprietesRendu } from "./communs.tsx";
import { RenduBudget, RenduCitations, RenduDroits, RenduFiltresEcartes, RenduFiltresExtraits, RenduLimite, RenduSeuil } from "./decisions.tsx";
import { RenduFusion } from "./fusion.tsx";
import { RenduAppelLlm, RenduPromptSysteme, RenduReponse, RenduTourLlm } from "./llm.tsx";
import { RenduOutil } from "./outil.tsx";
import { RenduCache, RenduCacheEcrit, RenduDegradation, RenduRepli, RenduVerification } from "./production.tsx";
import {
  RenduCondensation,
  RenduDiversite,
  RenduEmbedding,
  RenduFusionRequetes,
  RenduRechercheDeSecours,
  RenduRecherchePleinTexte,
  RenduRechercheVectorielle,
  RenduReclassement,
  RenduSimilarites,
  RenduTransformation,
} from "./recherche.tsx";

export type Rendu = (proprietes: ProprietesRendu) => ReactNode;

export const RENDUS: Record<string, Rendu> = {
  "prompt-systeme": RenduPromptSysteme,
  "tour-llm": RenduTourLlm,
  "appel-llm": RenduAppelLlm,
  reponse: RenduReponse,
  outil: RenduOutil,
  droits: RenduDroits,
  "filtres-extraits": RenduFiltresExtraits,
  "filtres-extraits-ecartes": RenduFiltresEcartes,
  condensation: RenduCondensation,
  transformation: RenduTransformation,
  embedding: RenduEmbedding,
  "recherche-vectorielle": RenduRechercheVectorielle,
  "recherche-plein-texte": RenduRecherchePleinTexte,
  fusion: RenduFusion,
  "fusion-requetes": RenduFusionRequetes,
  similarites: RenduSimilarites,
  reclassement: RenduReclassement,
  diversite: RenduDiversite,
  seuil: RenduSeuil,
  budget: RenduBudget,
  limite: RenduLimite,
  citations: RenduCitations,
  "recherche-de-secours": RenduRechercheDeSecours,
  verification: RenduVerification,
  cache: RenduCache,
  "cache-ecrit": RenduCacheEcrit,
  repli: RenduRepli,
  degradation: RenduDegradation,
};

export function RenduGenerique({ etape, contexte }: ProprietesRendu) {
  const vide = Object.keys(etape.details).length === 0;
  return (
    <>
      {etape.modele && (
        <div className="rendu-entete-ligne">
          <Modele etape={etape} />
        </div>
      )}
      {etape.usage && (
        <Section titre="Tokens">
          <JetonsLlm etape={etape} tarifs={contexte.tarifs} />
        </Section>
      )}
      <Section titre="Détail" note="cette étape n'a pas encore de rendu propre&nbsp;: son détail tel que le serveur l'envoie">
        {vide ? <p className="muet rendu-vide">Aucun détail&nbsp;: le résumé dit tout.</p> : <ArbreJson valeur={etape.details} ouvert={2} />}
      </Section>
    </>
  );
}
