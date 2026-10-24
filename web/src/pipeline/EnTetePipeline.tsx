// Le bilan d'une trace, en tête du pipeline : durée totale, part du LLM, tokens, coût, appels d'outils
import type { ReactNode } from "react";
import { cout as formaterCout, duree as formaterDuree, nombre, pluriel, pourcentage } from "../outils/format.ts";
import type { BilanTrace } from "./calculs.ts";

export function EnTetePipeline({ bilan, total, enCours, etapes }: { bilan: BilanTrace; total: number; enCours: boolean; etapes: number }) {
  const part = total > 0 ? Math.min(1, bilan.dureeLlm / total) : 0;
  const { cout } = bilan;
  const valeurCout = cout.inconnu && cout.max === 0 ? "inconnu" : Math.abs(cout.max - cout.min) < 1e-9 ? formaterCout(cout.min) : `${formaterCout(cout.min)} à ${formaterCout(cout.max)}`;
  const detailCout = cout.local ? "modèle local" : cout.inconnu ? "un modèle sans tarif" : "estimé, tarifs du serveur";
  return (
    <div className="pipeline-entete" role="group" aria-label="Bilan de la trace">
      <Mesure libelle="Durée totale" valeur={formaterDuree(total)} detail={enCours ? `en cours, ${pluriel(etapes, "étape")}` : pluriel(etapes, "étape")} />
      <Mesure libelle="Part du LLM" valeur={pourcentage(part)} detail={`${formaterDuree(bilan.dureeLlm)}, ${pluriel(bilan.appelsLlm, "appel")}`}>
        <span className="mesure-barre" aria-hidden="true">
          <span style={{ width: `${part * 100}%` }} />
        </span>
      </Mesure>
      <Mesure
        libelle="Tokens"
        valeur={
          <>
            {nombre(bilan.usage.entree)} <span className="muet">→</span> {nombre(bilan.usage.sortie)}
          </>
        }
        detail={`entrée → sortie, dont ${nombre(bilan.usage.enCache)} relus en cache`}
      />
      <Mesure libelle="Coût" valeur={valeurCout} detail={detailCout} />
      <Mesure libelle="Appels d'outils" valeur={nombre(bilan.appelsOutils)} detail={bilan.erreurs > 0 ? pluriel(bilan.erreurs, "étape en erreur", "étapes en erreur") : "aucune erreur"} alerte={bilan.erreurs > 0} />
    </div>
  );
}

function Mesure({ libelle, valeur, detail, children, alerte }: { libelle: string; valeur: ReactNode; detail?: string; children?: ReactNode; alerte?: boolean }) {
  return (
    <div className={`mesure${alerte ? " alerte" : ""}`}>
      <span className="mesure-libelle">{libelle}</span>
      <span className="mesure-valeur">{valeur}</span>
      {children}
      {detail && <span className="mesure-detail">{detail}</span>}
    </div>
  );
}
