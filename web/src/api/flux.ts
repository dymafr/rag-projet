// Lire une réponse en Server-Sent Events. EventSource ne sait faire que des GET : POST /ask se lit avec fetch, morceau
// par morceau. Un événement : des lignes « event: nom » et « data: … », terminées par une ligne vide
export type EvenementBrut = { nom: string; donnees: unknown };

export async function* lireEvenements(corps: ReadableStream<Uint8Array>): AsyncGenerator<EvenementBrut> {
  const lecteur = corps.getReader();
  const decodeur = new TextDecoder();
  let tampon = "";
  try {
    for (;;) {
      const { value, done } = await lecteur.read();
      if (done) break;
      // stream : un caractère coupé entre deux morceaux attend la suite
      tampon += decodeur.decode(value, { stream: true }).replace(/\r\n?/g, "\n");
      let fin = tampon.indexOf("\n\n");
      while (fin >= 0) {
        const bloc = tampon.slice(0, fin);
        tampon = tampon.slice(fin + 2);
        const evenement = lireBloc(bloc);
        if (evenement) yield evenement;
        fin = tampon.indexOf("\n\n");
      }
    }
  } finally {
    lecteur.releaseLock();
  }
}

function lireBloc(bloc: string): EvenementBrut | null {
  let nom = "message";
  const donnees: string[] = [];
  for (const ligne of bloc.split("\n")) {
    if (ligne.startsWith(":")) continue; // un commentaire (un battement de cœur)
    if (ligne.startsWith("event:")) nom = ligne.slice(6).trim();
    else if (ligne.startsWith("data:")) donnees.push(ligne.slice(5).replace(/^ /, ""));
  }
  if (donnees.length === 0) return null;
  try {
    return { nom, donnees: JSON.parse(donnees.join("\n")) as unknown };
  } catch {
    return null; // un événement illisible est ignoré : la suite du flux reste lisible
  }
}
