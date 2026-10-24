// Le disjoncteur (circuit breaker, chapitre 14, leçon 8). Quand un fournisseur tombe, chaque appel attend son délai
// d'expiration avant d'échouer : des minutes par question, multipliées par toutes les questions en cours.
// Après quelques échecs de suite, le disjoncteur s'ouvre : on n'appelle plus ce fournisseur pendant une pause, et l'on
// passe tout de suite au repli. Après la pause, un seul appel d'essai (demi-ouvert) : s'il réussit, tout reprend
export type EtatDisjoncteur = "ferme" | "ouvert" | "demi-ouvert";

export class DisjoncteurOuvert extends Error {
  constructor(nom: string) {
    super(`${nom} : disjoncteur ouvert, fournisseur mis de côté après des échecs répétés`);
  }
}

// Une erreur du fournisseur, et non de notre demande : limite de débit ou plafond de dépense (429), paiement (402),
// surcharge (529), panne (5xx), ou pas de réponse du tout : le réseau (connexion refusée ou coupée, délai dépassé ; les
// SDK lèvent alors une APIConnectionError, sans statut). Chez Anthropic, un plafond de dépense fixé soi-même répond 400
// (un crédit épuisé aussi, d'après des utilisateurs) : reconnus à leur message, ils comptent aussi. Une autre demande mal
// formée (400) échouerait aussi chez le repli ; une autre erreur sans statut est un bogue de Rhéa, pas une panne du fournisseur
const RESEAU = /connection|timed? ?out|ECONN|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|fetch failed|socket hang up/i;
const PLAFOND = /spend(ing)? limit|usage limit|credit balance/i;
export function duFournisseur(erreur: unknown): boolean {
  if (erreur instanceof DisjoncteurOuvert) return true;
  const { status, name = "", message = "", cause } = erreur as { status?: number; name?: string; message?: string; cause?: { code?: string } };
  if (status !== undefined) return [402, 408, 429].includes(status) || status >= 500 || (status === 400 && PLAFOND.test(message));
  return RESEAU.test(`${name} ${message} ${cause?.code ?? ""}`);
}

export class Disjoncteur {
  readonly nom: string;
  readonly #seuil: number;
  readonly #pause: number;
  readonly #maintenant: () => number;
  #echecs = 0;
  #ouvertJusqua = 0;
  #essaiEnCours = false;

  // seuil : échecs de suite avant d'ouvrir ; pause : en millisecondes. maintenant : l'horloge, remplaçable dans les tests
  constructor(nom: string, { seuil = 3, pause = 60_000, maintenant = Date.now } = {}) {
    this.nom = nom;
    this.#seuil = seuil;
    this.#pause = pause;
    this.#maintenant = maintenant;
  }

  get etat(): EtatDisjoncteur {
    if (this.#echecs < this.#seuil) return "ferme";
    return this.#maintenant() < this.#ouvertJusqua ? "ouvert" : "demi-ouvert";
  }

  async appeler<T>(appel: () => Promise<T>): Promise<T> {
    const etat = this.etat;
    // Ouvert, ou demi-ouvert avec déjà un appel d'essai en cours : refusé tout de suite, sans attendre le fournisseur
    if (etat === "ouvert" || (etat === "demi-ouvert" && this.#essaiEnCours)) throw new DisjoncteurOuvert(this.nom);
    if (etat === "demi-ouvert") this.#essaiEnCours = true;
    try {
      const resultat = await appel();
      this.#echecs = 0; // un succès referme le disjoncteur
      return resultat;
    } catch (erreur) {
      if (duFournisseur(erreur)) {
        this.#echecs++;
        if (this.#echecs >= this.#seuil) this.#ouvertJusqua = this.#maintenant() + this.#pause;
      }
      throw erreur;
    } finally {
      if (etat === "demi-ouvert") this.#essaiEnCours = false;
    }
  }
}
