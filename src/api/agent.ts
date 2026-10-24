// Ce que fait Rhéa pour une question posée au serveur (chapitre 14) : l'agent complet, et non plus le pipeline du
// chapitre 7. Les événements partent au fil de l'eau : chaque étape de la trace dès qu'elle commence et finit (en mode
// inspection), une demande de confirmation avant une action, puis la réponse, ses sources et ce qu'elle a coûté
import { agir, type Agent } from "../agent/boucle.ts";
import { sourcesCitees } from "../agent/sources.ts";
import { cout, type Tarifs } from "../eval/comparaison.ts";
import type { Usage } from "../llm.ts";
import type { Echange } from "../recherche/conversation.ts";
import type { Profil } from "../recherche/droits.ts";
import type { Resultat } from "../recherche/vectorielle.ts";
import { avecTrace, enBref, noter, pluriel, Trace, type EvenementTrace, type Modele } from "../trace/trace.ts";
import { Canal } from "./canal.ts";
import type { Confirmations } from "./confirmations.ts";

// Le salarié connecté : son matricule et son profil, lu dans l'annuaire
export type Session = { matricule: string; profil: Profil };

export type SourceCitee = ReturnType<typeof enBref> & { texte: string };
export type Fin = { usage: Usage; cout: { min: number; max: number } | null; duree_ms: number; modele: Modele; prompt: string; tours: number };

export type EvenementAgent =
  | { nom: "etape"; donnees: EvenementTrace }
  | { nom: "confirmation"; donnees: { id: string; action: string } }
  | { nom: "texte"; donnees: { texte: string } }
  | { nom: "sources"; donnees: { citees: SourceCitee[]; inventees: string[] } }
  | { nom: "fin"; donnees: Fin };

export type DependancesAgent = {
  // Rhéa pour cette session ; confirmer : la demande d'accord avant une action, que le serveur fait passer au navigateur
  agent: (session: Session, confirmer: Agent["confirmer"]) => Agent;
  confirmations: Confirmations;
  date: () => string; // la date du jour, AAAA-MM-JJ
  version: string; // celle du prompt système : v6 1a2b3c4d
  tarifs?: Tarifs; // pour le coût d'une réponse ; absent ou sans le modèle : coût inconnu (un modèle local ne coûte rien)
  inspection: boolean; // la trace part-elle au navigateur ?
};

export async function* repondreEnAgent(
  question: string,
  session: Session,
  dependances: DependancesAgent,
  signal?: AbortSignal,
  historique: Echange[] = [],
): AsyncGenerator<EvenementAgent> {
  const canal = new Canal<EvenementAgent>();
  // Sans inspection (en production), rien de la trace ne part au navigateur : ni les passages lus, ni le prompt
  const trace = new Trace(dependances.inspection ? (evenement) => canal.pousser({ nom: "etape", donnees: evenement }) : undefined);
  const confirmer: Agent["confirmer"] = (_appel, action) => {
    const { id, reponse } = dependances.confirmations.demander(session.matricule, signal);
    canal.pousser({ nom: "confirmation", donnees: { id, action } });
    return reponse;
  };
  const agent = dependances.agent(session, confirmer);
  const modele = agent.modele ?? { fournisseur: "inconnu", modele: "inconnu" };
  const debut = performance.now();
  const duree = () => Math.round(performance.now() - debut);

  const travail = avecTrace(trace, async () => {
    const contexte = { date: dependances.date(), matricule: session.matricule, profil: session.profil };
    await suivreAgent(contexte);
  });
  travail.then(
    () => canal.fermer(),
    (erreur: unknown) => canal.fermer(erreur),
  );
  yield* canal;

  async function suivreAgent(contexte: { date: string; matricule: string; profil: Profil }) {
    const vus: Resultat[] = []; // tous les passages rendus par les outils : seules leurs sources peuvent être citées
    for await (const e of agir(question, agent, contexte, historique)) {
      if (signal?.aborted) return; // le salarié est parti : inutile d'aller plus loin
      if (e.type === "resultat") vus.push(...(e.resultat.passages ?? []));
      if (e.type !== "reponse") continue;
      // Une source citée doit venir d'un passage qu'un outil a rendu : sinon, le LLM l'a inventée (chapitre 10)
      const { citees, inventees } = sourcesCitees(e.texte, vus);
      noter("citations", "Sources citées", {
        resume: `${pluriel(citees.length, "source citée", "sources citées")}${inventees.length > 0 ? `, ${pluriel(inventees.length, "introuvable")}` : ""}`,
        details: { citees: citees.map(enBref), inventees },
      });
      const sources = citees.map((p) => ({ ...enBref(p), texte: p.texte }));
      canal.pousser({ nom: "texte", donnees: { texte: e.texte } });
      canal.pousser({ nom: "sources", donnees: { citees: sources, inventees } });
      const prix = dependances.tarifs ? cout(e.usage, 0, `${modele.fournisseur} ${modele.modele}`, dependances.tarifs) : null;
      canal.pousser({ nom: "fin", donnees: { usage: e.usage, cout: prix, duree_ms: duree(), modele, prompt: dependances.version, tours: e.tour } });
    }
  }
}
