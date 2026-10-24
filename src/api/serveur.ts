// Le serveur HTTP de Rhéa. POST /ask répond en flux, au format Server-Sent Events, avec l'agent complet (chapitre 14 :
// le même que celui qu'on évalue). GET / sert l'interface (web/, construite dans web/dist), et, en mode inspection, les
// routes /api lui donnent tout ce qu'il faut pour montrer chaque étape
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { extname, resolve, sep } from "node:path";
import { z } from "zod";
import { pourLeTerminal } from "../ingestion/secrets.ts";
import { TOURS } from "../recherche/conversation.ts";
import type { Profil } from "../recherche/droits.ts";
import { repondreEnAgent, type DependancesAgent, type Session } from "./agent.ts";
import type { Inspection } from "./inspection.ts";

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
const Accord = z.strictObject({ id: z.uuid("identifiant de confirmation invalide"), accord: z.boolean("accord : true ou false") });
const RechercheSeule = z.strictObject({ question: Question, date: z.iso.date("date au format AAAA-MM-JJ").optional() });

// Le serveur a besoin, en plus de l'agent, du profil d'un salarié (chapitre 13), lu dans l'annuaire (null : matricule
// inconnu), et, en mode inspection, des lectures de l'interface. web : le dossier de l'interface construite
export type DependancesServeur = DependancesAgent & {
  profil: (matricule: string) => Promise<Profil | null>;
  inspecter?: Inspection; // absent : aucune route /api (production)
  web?: string;
};

// La politique de sécurité du contenu (CSP) de l'interface : elle ne charge que ses propres fichiers et ne parle qu'à ce
// serveur. Un texte piégé affiché dans la page (un passage, une réponse) ne pourrait ni charger un script d'ailleurs, ni
// envoyer des données ailleurs. Les styles en ligne restent permis : React en pose sur certains éléments
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const EN_TETES = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

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

// Le corps validé par son schéma, ou la réponse d'erreur déjà envoyée (null)
async function lireCorps<T>(req: http.IncomingMessage, res: http.ServerResponse, schema: z.ZodType<T>): Promise<T | null> {
  try {
    const lu = schema.safeParse(await lireJson(req));
    if (lu.success) return lu.data;
    repondreJson(res, 400, { erreur: lu.error.issues[0].message });
  } catch (erreur) {
    const tropGros = erreur instanceof RangeError;
    repondreJson(res, tropGros ? 413 : 400, { erreur: tropGros ? "corps trop gros" : "JSON invalide" });
  }
  return null;
}

// 2. Un événement SSE : son nom, ses données en JSON sur une ligne, et une ligne vide qui le termine
export const evenementSSE = (nom: string, donnees: unknown) => `event: ${nom}\ndata: ${JSON.stringify(donnees)}\n\n`;

const repondreJson = (res: http.ServerResponse, statut: number, corps: unknown) =>
  void res.writeHead(statut, { ...EN_TETES, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(JSON.stringify(corps));

// 3. Qui pose la question (chapitre 13). Ce projet n'a pas de vraie connexion : l'en-tête X-Matricule la simule. En
// production, l'identité viendrait d'une session ou d'un jeton vérifiés, jamais d'une valeur que le client choisit.
// Le profil, lui, se lit dans l'annuaire. Sans en-tête valide, ou pour un matricule inconnu : refus, avant toute lecture
async function lireSession(req: http.IncomingMessage, res: http.ServerResponse, dependances: DependancesServeur): Promise<Session | null> {
  const matricule = req.headers["x-matricule"];
  if (typeof matricule !== "string" || !/^K\d{4}$/.test(matricule)) {
    repondreJson(res, 401, { erreur: "en-tête X-Matricule attendu : le matricule du salarié connecté, K0101 par exemple" });
    return null;
  }
  try {
    const profil = await dependances.profil(matricule);
    if (profil) return { matricule, profil };
    repondreJson(res, 403, { erreur: "matricule inconnu" });
  } catch (erreur) {
    console.error("Erreur pendant la lecture du profil :", pourLeTerminal(erreur));
    repondreJson(res, 500, { erreur: "Rhéa n'a pas pu vérifier vos droits. Réessayez dans un instant." });
  }
  return null;
}

// Un autre site ouvert dans le navigateur ne peut pas envoyer de JSON ici sans l'accord du serveur (CORS), qui ne le donne
// pas : exiger ce type l'empêche de lancer des appels au LLM, que vous paieriez
const enJson = (req: http.IncomingMessage) => req.headers["content-type"]?.startsWith("application/json") === true;

// 4. POST /ask : la réponse en flux. Chaque événement part dès qu'il est prêt ; si le client lit moins vite que Rhéa
// n'écrit, write renvoie false : on attend l'événement drain avant d'écrire la suite
async function ask(req: http.IncomingMessage, res: http.ServerResponse, dependances: DependancesServeur) {
  const session = await lireSession(req, res, dependances);
  if (!session) return;
  const demande = await lireCorps(req, res, Demande);
  if (!demande) return;
  await repondreEnFluxSSE(req, res, dependances, session, demande);
}

async function repondreEnFluxSSE(req: http.IncomingMessage, res: http.ServerResponse, dependances: DependancesServeur, session: Session, demande: z.infer<typeof Demande>) {
  // Si le client part avant la fin (onglet fermé, bouton Arrêter), on arrête : inutile de rédiger une réponse que personne
  // ne lira, et une action en attente de confirmation est refusée
  const annulation = new AbortController();
  res.on("close", () => {
    if (res.writableFinished) return;
    annulation.abort();
    console.log("Client parti avant la fin : réponse abandonnée");
  });
  // (X-Accel-Buffering ne sert que derrière nginx, qui sinon retiendrait le flux)
  res.writeHead(200, { ...EN_TETES, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" });
  res.flushHeaders(); // les en-têtes partent tout de suite, sans attendre la recherche
  // Un proxy (nginx, leçon 10) coupe une connexion muette, au bout de 60 s par défaut, et un tour du LLM local peut durer
  // une minute. Une ligne de commentaire toutes les 15 s, que le navigateur ignore (« : », spécification des SSE), la garde
  const battement = setInterval(() => res.write(": \n\n"), 15_000);
  try {
    for await (const { nom, donnees } of repondreEnAgent(demande.question, session, dependances, annulation.signal, demande.historique)) {
      if (annulation.signal.aborted) return;
      if (!res.write(evenementSSE(nom, donnees))) await once(res, "drain", { signal: annulation.signal });
    }
  } catch (erreur) {
    if (annulation.signal.aborted) return; // le client est parti : personne à prévenir
    // Le détail reste dans le terminal du serveur : un message d'erreur peut contenir un bout de clé, une requête SQL, un
    // chemin. Chapitre 13 : même là, un secret reconnu est caviardé ; le terminal finit souvent dans un journal
    console.error("Erreur pendant la réponse :", pourLeTerminal(erreur));
    res.write(evenementSSE("erreur", { message: "Rhéa n'a pas pu terminer sa réponse. Réessayez dans un instant." }));
  } finally {
    clearInterval(battement);
  }
  res.end();
}

// 5. POST /ask/confirmation : la réponse du salarié à une demande d'accord, avant une action
async function confirmer(req: http.IncomingMessage, res: http.ServerResponse, dependances: DependancesServeur) {
  const session = await lireSession(req, res, dependances);
  if (!session) return;
  const accord = await lireCorps(req, res, Accord);
  if (!accord) return;
  if (!dependances.confirmations.repondre(accord.id, session.matricule, accord.accord)) {
    return repondreJson(res, 404, { erreur: "demande de confirmation inconnue ou expirée" });
  }
  repondreJson(res, 200, { ok: true });
}

// 6. Les routes de l'inspection. Celles qui lisent des documents passent par le profil du salarié connecté
async function api(req: http.IncomingMessage, res: http.ServerResponse, chemin: string, dependances: DependancesServeur, inspecter: Inspection) {
  if (req.method === "GET" && chemin === "/api/salaries") return repondreJson(res, 200, await inspecter.salaries());
  if (req.method === "GET" && chemin === "/api/configuration") return repondreJson(res, 200, await inspecter.configuration());
  const routes: [string, RegExp, (session: Session, m: RegExpMatchArray) => Promise<void>][] = [
    ["GET", /^\/api\/documents$/, async (s) => repondreJson(res, 200, await inspecter.documents(s.profil))],
    ["GET", /^\/api\/documents\/([A-Z0-9-]{2,40})$/, async (s, m) => {
      const passages = await inspecter.passagesDuDocument(m[1], s.profil);
      // Un document réservé et un document qui n'existe pas donnent la même réponse : rien ne trahit son existence
      if (passages.length === 0) return repondreJson(res, 404, { erreur: "document introuvable" });
      repondreJson(res, 200, passages);
    }],
    ["GET", /^\/api\/passages\/([A-Z0-9-]{2,40}%23\d{1,4}|[A-Z0-9-]{2,40}#\d{1,4})$/, async (s, m) => {
      const passage = await inspecter.passage(decodeURIComponent(m[1]), s.profil);
      if (!passage) return repondreJson(res, 404, { erreur: "passage introuvable" });
      repondreJson(res, 200, passage);
    }],
    ["POST", /^\/api\/rechercher$/, async (s) => {
      if (!enJson(req)) return repondreJson(res, 415, { erreur: "Content-Type: application/json attendu" });
      const demande = await lireCorps(req, res, RechercheSeule);
      if (!demande) return;
      repondreJson(res, 200, await inspecter.rechercher(demande.question, demande.date ?? dependances.date(), s.profil));
    }],
  ];
  for (const [methode, motif, traiter] of routes) {
    const m = chemin.match(motif);
    if (req.method !== methode || !m) continue;
    const session = await lireSession(req, res, dependances);
    if (session) await traiter(session, m);
    return;
  }
  repondreJson(res, 404, { erreur: "route inconnue" });
}

// 7. L'interface : un fichier de web/dist, ou sa page, pour toute adresse sans extension (l'interface gère ses vues).
// resolve puis le préfixe : un chemin en ../ ne sort jamais du dossier
async function servirInterface(res: http.ServerResponse, chemin: string, web: string) {
  const racine = resolve(web);
  let decode: string;
  try {
    decode = decodeURIComponent(chemin);
  } catch {
    return repondreJson(res, 400, { erreur: "adresse mal encodée" }); // « %E0%A4%A » : une demande fausse, pas une panne
  }
  const demande = resolve(racine, `.${decode}`);
  if (demande !== racine && !demande.startsWith(racine + sep)) return repondreJson(res, 404, { erreur: "inconnu" });
  const page = extname(demande) === "";
  const fichier = page ? resolve(racine, "index.html") : demande;
  try {
    const contenu = await readFile(fichier);
    // Les fichiers de web/dist/assets portent leur empreinte dans leur nom : ils peuvent rester en cache ; la page, non
    const cache = fichier.includes(`${sep}assets${sep}`) ? "public, max-age=31536000, immutable" : "no-cache";
    res.writeHead(200, { ...EN_TETES, "Content-Type": TYPES[extname(fichier)] ?? "application/octet-stream", "Cache-Control": cache, "Content-Security-Policy": CSP });
    res.end(contenu);
  } catch {
    if (page) return repondreJson(res, 503, { erreur: "interface absente : lancez npm run web:construire" });
    repondreJson(res, 404, { erreur: "inconnu" });
  }
}

// En développement (mode inspection), joint sur cette machine, le serveur n'accepte que les noms de cette machine : une
// page piégée qui fait pointer son propre nom de domaine vers 127.0.0.1 (DNS rebinding) deviendrait sinon de même origine
// que Rhéa, et CORS ne l'arrêterait plus. En production, c'est le proxy, devant Rhéa, qui n'accepte que son nom (leçon 10)
const NOMS_LOCAUX = new Set(["localhost", "127.0.0.1", "[::1]"]);
function hoteRefuse(req: http.IncomingMessage, inspection: boolean) {
  if (!inspection || !/^(127\.|::1$|::ffff:127\.)/.test(req.socket.localAddress ?? "")) return false;
  try {
    return !NOMS_LOCAUX.has(new URL(`http://${req.headers.host ?? ""}`).hostname);
  } catch {
    return true; // un en-tête Host absent ou illisible
  }
}

export function creerServeur(dependances: DependancesServeur): http.Server {
  return http.createServer(async (req, res) => {
    if (hoteRefuse(req, dependances.inspection)) return repondreJson(res, 403, { erreur: "hôte inconnu : ouvrez Rhéa par localhost" });
    const chemin = new URL(req.url ?? "/", "http://localhost").pathname;
    try {
      if (req.method === "POST" && (chemin === "/ask" || chemin === "/ask/confirmation")) {
        if (!enJson(req)) return repondreJson(res, 415, { erreur: "Content-Type: application/json attendu" });
        return await (chemin === "/ask" ? ask(req, res, dependances) : confirmer(req, res, dependances));
      }
      if (chemin.startsWith("/api/")) {
        if (!dependances.inspecter) return repondreJson(res, 404, { erreur: "inspection désactivée" });
        return await api(req, res, chemin, dependances, dependances.inspecter);
      }
      if (req.method === "GET" && dependances.web) return await servirInterface(res, chemin, dependances.web);
      repondreJson(res, 404, { erreur: "inconnu : POST /ask, ou GET / pour l'interface" });
    } catch (erreur) {
      console.error("Erreur du serveur :", pourLeTerminal(erreur));
      if (!res.headersSent) repondreJson(res, 500, { erreur: "erreur du serveur" });
      else res.end();
    }
  });
}
