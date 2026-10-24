// Les confirmations en attente (chapitre 14) : avant une action (ouvrir un ticket), l'agent attend l'accord du salarié.
// En ligne de commande, il le tape au clavier ; dans l'interface, le serveur envoie la demande, avec un identifiant, et
// le navigateur répond par POST /ask/confirmation. Sans réponse à temps, ou si le salarié part, c'est un refus : une
// action ne s'exécute jamais par défaut
import { randomUUID } from "node:crypto";

export const DELAI_CONFIRMATION_MS = 120_000;

type Attente = { matricule: string; decider: (accord: boolean) => void };

export class Confirmations {
  readonly #attentes = new Map<string, Attente>();

  get enAttente(): number {
    return this.#attentes.size;
  }

  // Une demande pour ce salarié : son identifiant (aléatoire : impossible à deviner), et la promesse de sa réponse
  demander(matricule: string, signal?: AbortSignal, delai = DELAI_CONFIRMATION_MS): { id: string; reponse: Promise<boolean> } {
    const id = randomUUID();
    // Le salarié déjà parti (un signal déjà annulé ne déclenche plus « abort ») : refus tout de suite
    if (signal?.aborted) return { id, reponse: Promise.resolve(false) };
    const reponse = new Promise<boolean>((resoudre) => {
      const minuterie = setTimeout(() => decider(false), delai);
      const decider = (accord: boolean) => {
        clearTimeout(minuterie);
        signal?.removeEventListener("abort", refuser);
        this.#attentes.delete(id);
        resoudre(accord);
      };
      const refuser = () => decider(false);
      signal?.addEventListener("abort", refuser, { once: true });
      this.#attentes.set(id, { matricule, decider });
    });
    return { id, reponse };
  }

  // La réponse du navigateur. Seul le salarié à qui la demande a été faite peut y répondre ; false : demande inconnue,
  // expirée, ou d'un autre salarié
  repondre(id: string, matricule: string, accord: boolean): boolean {
    const attente = this.#attentes.get(id);
    if (!attente || attente.matricule !== matricule) return false;
    attente.decider(accord);
    return true;
  }
}
