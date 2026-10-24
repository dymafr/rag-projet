// Le limiteur (chapitre 14, leçon 8) : au plus tant de questions traitées en même temps, et une file d'attente bornée
// derrière. Au-delà, mieux vaut dire tout de suite « réessayez dans un instant » (503) que d'accepter des questions qui
// attendront des minutes, ou qui feront dépasser les limites de débit du fournisseur pour tout le monde
export class Sature extends Error {
  constructor() {
    super("trop de questions en cours : réessayez dans un instant");
  }
}

// Une question abandonnée pendant son attente (le salarié a fermé l'onglet) : elle quitte la file sans prendre de place
export class Abandonnee extends Error {
  constructor() {
    super("question abandonnée pendant son attente");
  }
}

export class Limiteur {
  readonly #max: number;
  readonly #attenteMax: number;
  #enCours = 0;
  readonly #file: (() => void)[] = [];

  constructor(max = 4, attenteMax = 20) {
    this.#max = max;
    this.#attenteMax = attenteMax;
  }

  get etat() {
    return { enCours: this.#enCours, enAttente: this.#file.length, max: this.#max, attenteMax: this.#attenteMax };
  }

  // Une place, rendue à la fin de fn, même en cas d'erreur. Sature : la file est pleine. Abandonnee : signal a été
  // déclenché pendant l'attente ; sans lui, une question dont le salarié est parti garderait sa place jusqu'au bout
  async avecPlace<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw new Abandonnee();
    if (this.#enCours >= this.#max) {
      if (this.#file.length >= this.#attenteMax) throw new Sature();
      await new Promise<void>((place, abandon) => {
        const quitter = () => {
          this.#file.splice(this.#file.indexOf(prendre), 1);
          abandon(new Abandonnee());
        };
        const prendre = () => {
          signal?.removeEventListener("abort", quitter);
          place();
        };
        this.#file.push(prendre);
        signal?.addEventListener("abort", quitter, { once: true });
      });
    } else {
      this.#enCours++;
    }
    try {
      return await fn();
    } finally {
      const suivant = this.#file.shift();
      if (suivant) suivant(); // la place passe directement au suivant : enCours ne change pas
      else this.#enCours--;
    }
  }
}
