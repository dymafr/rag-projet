// Les appels au serveur de Rhéa. Le salarié connecté part dans l'en-tête X-Matricule (le serveur simule ainsi une
// connexion, chapitre 13) ; une erreur garde son statut HTTP et le message du serveur, que l'interface affiche
import { estObjet } from "../outils/lecture.ts";

export class ErreurApi extends Error {
  readonly statut: number; // 0 : le serveur n'a pas répondu

  constructor(statut: number, message: string) {
    super(message);
    this.statut = statut;
  }

  // Le serveur tourne sans le mode inspection : les routes /api n'existent pas
  get inspectionDesactivee() {
    return this.statut === 404 && this.message === "inspection désactivée";
  }

  get injoignable() {
    return this.statut === 0 || this.statut === 502 || this.statut === 504;
  }

  // La route n'existe pas encore : chaque route arrive avec sa leçon du chapitre 14, et répond 404 avant (« route
  // inconnue » sous /api, « inconnu… » ailleurs ; ou la page de l'interface, que le serveur rend pour toute adresse)
  get routeAbsente() {
    return this.statut === 404 && (this.message === ROUTE_INCONNUE || this.message.startsWith("inconnu"));
  }
}

export const ROUTE_INCONNUE = "route inconnue";

// La leçon du chapitre 14 qui ajoute chaque route : avant elle, la vue le dit au lieu d'afficher une erreur
export const LECONS = {
  evaluations: { lecon: 2, sujet: "évaluations" },
  desaccords: { lecon: 4, sujet: "désaccords entre juges" },
  observabilite: { lecon: 7, sujet: "observabilité" },
  retours: { lecon: 7, sujet: "avis des salariés" },
  sante: { lecon: 8, sujet: "santé du service" },
} as const;

export const SERVEUR_INJOIGNABLE = "Le serveur de Rhéa ne répond pas. Lancez-le avec npm run serveur, puis réessayez.";

export type OptionsAppel = { matricule?: string; corps?: unknown; signal?: AbortSignal };

export function enTetes(options: { matricule?: string; json?: boolean }): HeadersInit {
  return {
    Accept: "application/json",
    ...(options.json && { "Content-Type": "application/json" }),
    ...(options.matricule && { "X-Matricule": options.matricule }),
  };
}

// Le message d'erreur d'une réponse : celui du serveur ({ erreur }), sinon un message selon le statut
export async function messageDErreur(reponse: Response): Promise<string> {
  try {
    const corps: unknown = await reponse.json();
    if (estObjet(corps) && typeof corps.erreur === "string") return corps.erreur;
  } catch {
    // pas de JSON : le message selon le statut
  }
  if (reponse.status === 502 || reponse.status === 504) return SERVEUR_INJOIGNABLE;
  if (reponse.status >= 500) return "Le serveur a rencontré une erreur. Réessayez dans un instant.";
  return `Réponse inattendue du serveur (${reponse.status}).`;
}

export async function appeler<T>(chemin: string, options: OptionsAppel = {}): Promise<T> {
  let reponse: Response;
  try {
    reponse = await fetch(chemin, {
      method: options.corps === undefined ? "GET" : "POST",
      headers: enTetes({ matricule: options.matricule, json: options.corps !== undefined }),
      body: options.corps === undefined ? undefined : JSON.stringify(options.corps),
      signal: options.signal,
      cache: "no-store",
    });
  } catch (erreur) {
    if (erreur instanceof DOMException && erreur.name === "AbortError") throw erreur;
    throw new ErreurApi(0, SERVEUR_INJOIGNABLE);
  }
  if (!reponse.ok) throw new ErreurApi(reponse.status, await messageDErreur(reponse));
  // Une page HTML au lieu de JSON : le serveur ne connaît pas cette adresse et rend l'interface (une route d'une leçon à venir)
  if (!reponse.headers.get("content-type")?.includes("json")) throw new ErreurApi(404, ROUTE_INCONNUE);
  try {
    return (await reponse.json()) as T;
  } catch {
    throw new ErreurApi(reponse.status, "Le serveur a renvoyé une réponse illisible.");
  }
}

export const estAbandon = (erreur: unknown) => erreur instanceof DOMException && erreur.name === "AbortError";

// Le chemin d'un passage : le # s'encode (%23), sinon le navigateur le prendrait pour une ancre
export const cheminDuPassage = (id: string) => `/api/passages/${encodeURIComponent(id)}`;
