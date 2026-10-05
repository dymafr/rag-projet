// Le serveur HTTP de Rhéa : POST /ask répond en flux, au format Server-Sent Events ; GET / sert la page de chat
import { once } from "node:events";
import { readFileSync } from "node:fs";
import http from "node:http";
import { z } from "zod";
import { repondreEnFlux, type Dependances } from "./rhea.ts";

const TAILLE_MAX = 16 * 1024; // 16 Kio : largement assez pour une question
const Demande = z.strictObject(
  { question: z.string("la question doit être un texte").trim().min(1, "la question est vide").max(1000, "la question dépasse 1 000 caractères") },
  "attendu : un objet JSON avec la seule clé question",
);
// La page de chat, lue une fois au démarrage : son chemin part de ce fichier, pas du dossier d'où l'on lance Node
const PAGE = readFileSync(new URL("../../public/index.html", import.meta.url));

// 1. Lire le corps JSON de la requête, sans jamais accepter plus de TAILLE_MAX octets
async function lireJson(req: http.IncomingMessage): Promise<unknown> {
  if (Number(req.headers["content-length"] ?? 0) > TAILLE_MAX) throw new RangeError("corps trop gros");
  const morceaux: Buffer[] = [];
  let taille = 0;
  for await (const morceau of req as AsyncIterable<Buffer>) {
    taille += morceau.length;
    if (taille > TAILLE_MAX) throw new RangeError("corps trop gros");
    morceaux.push(morceau);
  }
  return JSON.parse(Buffer.concat(morceaux).toString("utf8")); // SyntaxError si ce n'est pas du JSON
}

// 2. Un événement SSE : son nom, ses données en JSON sur une ligne, et une ligne vide qui le termine
export const evenementSSE = (nom: string, donnees: unknown) => `event: ${nom}\ndata: ${JSON.stringify(donnees)}\n\n`;

const repondreJson = (res: http.ServerResponse, statut: number, corps: object) =>
  void res.writeHead(statut, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify(corps));

export function creerServeur(dependances: Dependances): http.Server {
  return http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/") return void res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(PAGE);
    if (req.method !== "POST" || req.url !== "/ask") return repondreJson(res, 404, { erreur: "inconnu : POST /ask ou GET /" });
    // Un autre site ouvert dans le navigateur ne peut pas envoyer de JSON ici sans l'accord du serveur (CORS), qui ne
    // le donne pas : exiger ce type l'empêche de lancer des appels au LLM, que vous paieriez
    if (!req.headers["content-type"]?.startsWith("application/json")) {
      return repondreJson(res, 415, { erreur: "Content-Type: application/json attendu" });
    }

    // 3. Si le client part avant la fin (onglet fermé, bouton Arrêter), on coupe l'appel au LLM : inutile de générer
    // une réponse que personne ne lira. res.writableFinished dit si la réponse était déjà entièrement partie
    const annulation = new AbortController();
    res.on("close", () => {
      if (res.writableFinished) return;
      annulation.abort();
      console.log("Client parti avant la fin : réponse abandonnée");
    });

    let question: string;
    try {
      const demande = Demande.safeParse(await lireJson(req));
      if (!demande.success) return repondreJson(res, 400, { erreur: demande.error.issues[0].message });
      question = demande.data.question;
    } catch (erreur) {
      const tropGros = erreur instanceof RangeError;
      return repondreJson(res, tropGros ? 413 : 400, { erreur: tropGros ? "corps trop gros" : "JSON invalide" });
    }

    // 4. Le flux : chaque événement part dès qu'il est prêt. Si le client lit moins vite que Rhéa n'écrit,
    // write renvoie false : on attend l'événement drain avant d'écrire la suite
    // (X-Accel-Buffering ne sert que derrière nginx, qui sinon retiendrait le flux)
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" });
    res.flushHeaders(); // les en-têtes partent tout de suite, sans attendre la recherche
    try {
      for await (const { nom, donnees } of repondreEnFlux(question, dependances, annulation.signal)) {
        if (!res.write(evenementSSE(nom, donnees))) await once(res, "drain", { signal: annulation.signal });
      }
    } catch (erreur) {
      if (annulation.signal.aborted) return; // le client est parti : personne à prévenir
      // Le détail reste dans le terminal du serveur : un message d'erreur peut contenir un bout de clé, une requête SQL, un chemin
      console.error("Erreur pendant la réponse :", erreur);
      res.write(evenementSSE("erreur", { message: "Rhéa n'a pas pu terminer sa réponse. Réessayez dans un instant." }));
    }
    res.end();
  });
}
