// Le serveur HTTP de Rhéa : POST /ask répond en flux, au format Server-Sent Events ; GET / sert la page de chat
import { once } from "node:events";
import { readFileSync } from "node:fs";
import http from "node:http";
import { z } from "zod";
import { TOURS } from "../recherche/conversation.ts";
import { pourLeTerminal } from "../ingestion/secrets.ts";
import type { Profil } from "../recherche/droits.ts";
import { repondreEnFlux, type Dependances } from "./rhea.ts";

const TAILLE_MAX = 64 * 1024; // 64 Kio : assez pour une question et les derniers échanges, même en caractères de 3 octets
const Question = z.string("la question doit être un texte").trim().min(1, "la question est vide").max(1000, "la question dépasse 1 000 caractères");
const Echange = z.strictObject({
  question: z
    .string("historique : chaque question doit être un texte")
    .trim()
    .min(1, "historique : une question est vide")
    .max(1000, "historique : une question dépasse 1 000 caractères"),
  reponse: z.string("historique : chaque réponse doit être un texte").max(4000, "historique : une réponse dépasse 4 000 caractères"),
});
const Demande = z.strictObject(
  {
    question: Question,
    // Les échanges précédents de la conversation, s'il y en a (chapitre 9) : les TOURS derniers, ceux que lit la condensation
    historique: z.array(Echange).max(TOURS, `historique trop long : ${TOURS} échanges au plus`).default([]),
  },
  "attendu : un objet JSON avec la clé question, et l'historique s'il y en a un",
);
// Le serveur a besoin, en plus, du profil d'un salarié (chapitre 13) : lu dans l'annuaire ; null, matricule inconnu
export type DependancesServeur = Dependances & { profil: (matricule: string) => Promise<Profil | null> };

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

export function creerServeur(dependances: DependancesServeur): http.Server {
  return http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/") return void res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(PAGE);
    if (req.method !== "POST" || req.url !== "/ask") return repondreJson(res, 404, { erreur: "inconnu : POST /ask ou GET /" });
    // Un autre site ouvert dans le navigateur ne peut pas envoyer de JSON ici sans l'accord du serveur (CORS), qui ne
    // le donne pas : exiger ce type l'empêche de lancer des appels au LLM, que vous paieriez
    if (!req.headers["content-type"]?.startsWith("application/json")) {
      return repondreJson(res, 415, { erreur: "Content-Type: application/json attendu" });
    }

    // 3. Qui pose la question (chapitre 13). Ce projet n'a pas de vraie connexion : l'en-tête X-Matricule la simule. En
    // production, l'identité viendrait d'une session ou d'un jeton vérifiés, jamais d'une valeur que le client choisit.
    // Le profil, lui, se lit dans l'annuaire. Sans en-tête valide, ou pour un matricule inconnu : refus, avant toute recherche
    const matricule = req.headers["x-matricule"];
    if (typeof matricule !== "string" || !/^K\d{4}$/.test(matricule)) {
      return repondreJson(res, 401, { erreur: "en-tête X-Matricule attendu : le matricule du salarié connecté, K0101 par exemple" });
    }
    let profil: Profil | null;
    try {
      profil = await dependances.profil(matricule);
    } catch (erreur) {
      console.error("Erreur pendant la lecture du profil :", pourLeTerminal(erreur));
      return repondreJson(res, 500, { erreur: "Rhéa n'a pas pu vérifier vos droits. Réessayez dans un instant." });
    }
    if (!profil) return repondreJson(res, 403, { erreur: "matricule inconnu" });

    // 4. Si le client part avant la fin (onglet fermé, bouton Arrêter), on coupe l'appel au LLM : inutile de générer
    // une réponse que personne ne lira. res.writableFinished dit si la réponse était déjà entièrement partie
    const annulation = new AbortController();
    res.on("close", () => {
      if (res.writableFinished) return;
      annulation.abort();
      console.log("Client parti avant la fin : réponse abandonnée");
    });

    let demande: z.infer<typeof Demande>;
    try {
      const lue = Demande.safeParse(await lireJson(req));
      if (!lue.success) return repondreJson(res, 400, { erreur: lue.error.issues[0].message });
      demande = lue.data;
    } catch (erreur) {
      const tropGros = erreur instanceof RangeError;
      return repondreJson(res, tropGros ? 413 : 400, { erreur: tropGros ? "corps trop gros" : "JSON invalide" });
    }

    // 5. Le flux : chaque événement part dès qu'il est prêt. Si le client lit moins vite que Rhéa n'écrit,
    // write renvoie false : on attend l'événement drain avant d'écrire la suite
    // (X-Accel-Buffering ne sert que derrière nginx, qui sinon retiendrait le flux)
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" });
    res.flushHeaders(); // les en-têtes partent tout de suite, sans attendre la recherche
    try {
      for await (const { nom, donnees } of repondreEnFlux(demande.question, profil, dependances, annulation.signal, demande.historique)) {
        if (!res.write(evenementSSE(nom, donnees))) await once(res, "drain", { signal: annulation.signal });
      }
    } catch (erreur) {
      if (annulation.signal.aborted) return; // le client est parti : personne à prévenir
      // Le détail reste dans le terminal du serveur : un message d'erreur peut contenir un bout de clé, une requête SQL, un
      // chemin. Chapitre 13 : même là, un secret reconnu est caviardé ; le terminal finit souvent dans un journal
      console.error("Erreur pendant la réponse :", pourLeTerminal(erreur));
      res.write(evenementSSE("erreur", { message: "Rhéa n'a pas pu terminer sa réponse. Réessayez dans un instant." }));
    }
    res.end();
  });
}
