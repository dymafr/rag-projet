// Un canal : des valeurs poussées par un producteur (la trace, qui note ses étapes au fil de l'eau), lues dans l'ordre par
// un consommateur (le serveur, qui les envoie au navigateur) avec for await. Le producteur ferme le canal à la fin, ou
// avec une erreur, que le consommateur reçoit alors à la place de la valeur suivante
export class Canal<T> implements AsyncIterable<T> {
  readonly #file: T[] = [];
  #reveiller?: () => void;
  #ferme = false;
  #erreur: unknown;

  pousser(valeur: T) {
    if (this.#ferme) return; // trop tard : plus personne n'attend cette valeur
    this.#file.push(valeur);
    this.#reveiller?.();
  }

  fermer(erreur?: unknown) {
    this.#ferme = true;
    this.#erreur = erreur;
    this.#reveiller?.();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    while (true) {
      if (this.#file.length > 0) {
        yield this.#file.shift()!;
        continue;
      }
      if (this.#ferme) {
        if (this.#erreur !== undefined) throw this.#erreur;
        return;
      }
      await new Promise<void>((reveil) => (this.#reveiller = reveil));
      this.#reveiller = undefined;
    }
  }
}
