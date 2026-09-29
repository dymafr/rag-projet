// Appeler une API d'embeddings sur beaucoup de textes : par lots, et avec des reprises après une erreur passagère

// Découpe la liste en lots de taille fixe et les traite l'un après l'autre, dans l'ordre
export async function parLots<T, R>(elements: T[], taille: number, traiter: (lot: T[]) => Promise<R[]>): Promise<R[]> {
  const resultats: R[] = [];
  for (let debut = 0; debut < elements.length; debut += taille) {
    resultats.push(...(await traiter(elements.slice(debut, debut + taille))));
  }
  return resultats;
}

// Une erreur passagère vaut un nouvel essai : limite de débit (429), panne du serveur (5xx),
// ou pas de statut HTTP du tout, ce qui signale le plus souvent une coupure réseau
function passagere(erreur: unknown): boolean {
  const statut = (erreur as { status?: number }).status;
  return statut === undefined || statut === 429 || statut >= 500;
}

// Relance l'appel après une erreur passagère, en doublant l'attente à chaque fois : 1 s, 2 s, 4 s
export async function avecReprises<T>(appel: () => Promise<T>, essais = 4, attenteMs = 1000): Promise<T> {
  for (let essai = 1; ; essai++) {
    try {
      return await appel();
    } catch (erreur) {
      if (essai === essais || !passagere(erreur)) throw erreur;
      const attente = attenteMs * 2 ** (essai - 1);
      console.warn(`Essai ${essai} échoué (${erreur instanceof Error ? erreur.message : erreur}), nouvel essai dans ${attente} ms`);
      await new Promise((resolve) => setTimeout(resolve, attente));
    }
  }
}
