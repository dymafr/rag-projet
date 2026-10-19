// La boucle de l'agent. On envoie au LLM la question et la liste des outils ; tant qu'il demande des appels, notre code
// les exécute et lui renvoie les résultats ; quand il répond sans rien demander, c'est la réponse. Chaque étape est
// rendue au fil de l'eau (un générateur), pour que la ligne de commande ou le serveur l'affichent
import { z } from "zod";
import { finDuMessage } from "../generation/prompt.ts";
import type { Usage } from "../llm.ts";
import type { Echange } from "../recherche/conversation.ts";
import type { AppelOutil, LlmAgent, Message } from "./llm-agent.ts";
import type { Contexte, Outil, ResultatOutil } from "./outil.ts";

// Un tour : un appel au LLM. Au-delà de TOURS_MAX, la boucle s'arrête : un agent qui tourne en rond coûte sans rien rendre.
// Le dernier tour se fait sans outil (leçon 4) : le LLM doit répondre avec ce qu'il a déjà trouvé
export const TOURS_MAX = 5;
// Les garde-fous de la leçon 5 : un budget de tokens pour toute la question (entrée et sortie, tous tours compris), et un
// nombre d'appels par outil. Une question de Rhéa en demande 1 500 à 6 000 avec le modèle local
export const TOKENS_MAX = 20_000;
export const APPELS_PAR_OUTIL = 3;
export const DERNIER_TOUR =
  "Tu ne peux plus appeler d'outil. Réponds maintenant à la question avec ce que tes outils ont déjà rendu, et dis ce qui manque.";
// Si le LLM demande encore un appel au dernier tour (Ollama ignore tool_choice), la boucle répond à sa place
export const RECHERCHE_INACHEVEE = "Je n'ai pas pu terminer ma recherche. Reformulez votre question, ou ouvrez un ticket dans l'espace RH.";

// Ce que la boucle écrit dans le journal pour chaque appel d'outil (leçon 5)
export type Statut = "ok" | "erreur" | "refusé" | "limite";
export type EntreeJournal = {
  horodatage: string;
  matricule: string | null; // une donnée personnelle : le chapitre 13 fixera qui lit le journal, et combien de temps on le garde
  tour: number;
  outil: string;
  arguments: unknown;
  statut: Statut;
  duree_ms: number;
  resultat: string; // le début du texte rendu au LLM
};

export type Recherche = "libre" | "office" | "secours";

// Chapitre 13 : pour un manager ou le service RH, le profil, avant la date. Ce n'est pas le LLM qui décide de ce que le
// salarié peut lire : la recherche ne lui rend que ce qui est permis. Mais sans savoir à qui il parle, il refusait à une
// manager un passage marqué « réservé aux managers » (essai du 19 octobre). Pour un salarié, le message ne change pas :
// il ne reçoit que des documents ouverts à tous (une phrase de plus dans le prompt système, essayée le même jour, faisait
// sauter des recherches au modèle local)
export const profilConnecte = (profil: string) =>
  `Profil du salarié connecté : ${profil}. Il a le droit de lire tout ce que rendent tes outils, y compris un passage réservé.`;

export type Agent = {
  llm: LlmAgent;
  outils: Outil[];
  systeme: string;
  toursMax?: number;
  // recherche (leçon 4) : qui décide de la première recherche. libre : le LLM seul. office : le code cherche avant le
  // premier tour. secours : le LLM décide ; s'il répond sans appeler aucun outil, le code cherche et lui redemande.
  // Le code cherche la question, ou, pour une question de suite, la question autonome que rend condenser (chapitre 9)
  recherche?: Recherche;
  // Chapitre 12 : des appels que le code fait lui-même avant le premier tour, comme la recherche d'office (par exemple
  // la fiche du salarié connecté dans l'organigramme). Le LLM n'a plus à décider de les demander
  appelsDOffice?: AppelOutil[];
  condenser?: (question: string, historique: Echange[]) => Promise<string>;
  // Leçon 5. confirmer : demande au salarié son accord avant une action ; absent, aucune action ne s'exécute
  tokensMax?: number;
  appelsParOutil?: number;
  confirmer?: (appel: AppelOutil, resume: string) => Promise<boolean>;
  journaliser?: (entree: EntreeJournal) => Promise<void>;
};

export type Etape =
  | { type: "appel"; tour: number; appel: AppelOutil }
  // detail : la cause d'un échec de l'outil, pour le terminal ; le LLM ne reçoit qu'un message général
  | { type: "resultat"; tour: number; appel: AppelOutil; resultat: ResultatOutil; erreur: boolean; statut: Statut; detail?: string; duree: number }
  | { type: "reponse"; tour: number; texte: string; usage: Usage }
  | { type: "limite"; tour: number; raison: "tours" | "tokens" }; // le dernier tour commence : plus d'outil

type Execution = { resultat: ResultatOutil; erreur: boolean; statut: Statut; detail?: string };

// Chapitre 12 : un modèle local omet souvent un champ facultatif (nullable) au lieu de l'envoyer à null, comme le
// demande le schéma. On complète ces champs à null avant la validation : l'appel garde le sens que le LLM lui donnait
function completerNulls(parametres: z.ZodObject, args: unknown): unknown {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return args;
  const complet: Record<string, unknown> = { ...args };
  for (const [nom, schema] of Object.entries(parametres.shape)) {
    if (!(nom in complet) && (schema as z.ZodType).safeParse(null).success) complet[nom] = null;
  }
  return complet;
}

// Exécuter une demande d'appel. L'outil doit exister et les arguments passer la validation zod : le LLM écrit ces
// arguments, rien ne garantit qu'ils soient justes. Sinon, il reçoit l'erreur en résultat, et peut corriger son appel.
// Un outil qui agit (aConfirmer) attend l'accord du salarié : c'est le code qui le demande, pas le LLM
export async function executer(appel: AppelOutil, outils: Outil[], contexte: Contexte, confirmer?: Agent["confirmer"]): Promise<Execution> {
  const outil = outils.find((o) => o.nom === appel.nom);
  if (!outil) {
    const texte = `Outil inconnu : ${appel.nom}. Outils disponibles : ${outils.map((o) => o.nom).join(", ")}`;
    return { resultat: { texte }, erreur: true, statut: "erreur" };
  }
  const lus = outil.parametres.safeParse(completerNulls(outil.parametres, appel.arguments));
  if (!lus.success) return { resultat: { texte: `Arguments refusés :\n${z.prettifyError(lus.error)}` }, erreur: true, statut: "erreur" };
  if (outil.aConfirmer) {
    const accord = confirmer ? await confirmer(appel, outil.aConfirmer(lus.data)) : false;
    if (!accord) {
      const texte = "Le salarié n'a pas confirmé : rien n'a été fait. Dites-le-lui, sans réessayer.";
      return { resultat: { texte }, erreur: false, statut: "refusé" };
    }
  }
  try {
    return { resultat: await outil.executer(lus.data, contexte), erreur: false, statut: "ok" };
  } catch (erreur) {
    // Le détail (requête SQL, chemin de fichier…) ne part pas au LLM, qui pourrait le répéter au salarié
    const texte = "L'outil a échoué. Répondez sans lui, ou proposez d'ouvrir un ticket dans l'espace RH.";
    return { resultat: { texte }, erreur: true, statut: "erreur", detail: (erreur as Error).message };
  }
}

const ajouter = (total: Usage, usage: Usage) => {
  total.entree += usage.entree;
  total.enCache += usage.enCache;
  total.sortie += usage.sortie;
};

// historique : les échanges précédents de la conversation (chapitre 9, leçon 8). L'agent les lit tels quels : il n'a pas
// besoin d'une question condensée, il écrit lui-même ses requêtes
export async function* agir(question: string, agent: Agent, contexte: Contexte, historique: Echange[] = []): AsyncGenerator<Etape> {
  // Les échanges précédents, puis la date du jour (certaines règles changent) et la question, comme au chapitre 7
  const messages: Message[] = [
    ...historique.flatMap((e): Message[] => [
      { role: "utilisateur", texte: e.question },
      { role: "assistant", texte: e.reponse, appels: [] },
    ]),
    { role: "utilisateur", texte: (contexte.profil === "salarie" ? "" : `${profilConnecte(contexte.profil)}\n`) + finDuMessage(question, contexte.date) },
  ];
  const usage: Usage = { entree: 0, enCache: 0, sortie: 0 }; // le total de la conversation
  const toursMax = agent.toursMax ?? TOURS_MAX;
  const tokensMax = agent.tokensMax ?? TOKENS_MAX;
  const appelsParOutil = agent.appelsParOutil ?? APPELS_PAR_OUTIL;
  const appelsFaits = new Map<string, number>();

  // Un appel d'outil : la limite d'appels, l'exécution (avec la confirmation s'il le faut), le journal, puis le résultat
  // ajouté à la conversation
  async function* traiter(appel: AppelOutil, tour: number): AsyncGenerator<Etape> {
    yield { type: "appel", tour, appel };
    const debut = performance.now();
    const n = (appelsFaits.get(appel.nom) ?? 0) + 1;
    appelsFaits.set(appel.nom, n);
    const { resultat, erreur, statut, detail } =
      n > appelsParOutil
        ? { resultat: { texte: `Limite atteinte : ${appelsParOutil} appels de ${appel.nom} pour cette question. Répondez avec ce que vous avez.` }, erreur: true, statut: "limite" as const, detail: undefined }
        : await executer(appel, agent.outils, contexte, agent.confirmer);
    const duree = performance.now() - debut;
    await agent.journaliser?.({
      horodatage: new Date().toISOString(),
      matricule: contexte.matricule ?? null,
      tour,
      outil: appel.nom,
      arguments: appel.arguments,
      statut,
      duree_ms: Math.round(duree),
      resultat: resultat.texte.slice(0, 200),
    });
    yield { type: "resultat", tour, appel, resultat, erreur, statut, detail, duree };
    messages.push({ role: "outil", id: appel.id, nom: appel.nom, texte: resultat.texte, passages: resultat.passages, erreur });
  }

  // Une recherche imposée par le code. Elle entre dans la conversation comme si le LLM l'avait demandée
  async function* imposerRecherche(tour: number, id: string): AsyncGenerator<Etape> {
    const requete = historique.length > 0 && agent.condenser ? await agent.condenser(question, historique) : question;
    const appel: AppelOutil = { id, nom: "chercher_documents", arguments: { requete } };
    messages.push({ role: "assistant", texte: "", appels: [appel] });
    yield* traiter(appel, tour);
  }

  // 0. Une recherche d'office, comme dans le pipeline du chapitre 9 : le LLM ne peut plus décider de ne pas chercher (tour 0)
  const recherche = agent.recherche ?? "libre";
  if (recherche === "office") yield* imposerRecherche(0, "recherche-d-office");
  for (const appel of agent.appelsDOffice ?? []) {
    messages.push({ role: "assistant", texte: "", appels: [appel] });
    yield* traiter(appel, 0);
  }
  for (let tour = 1; tour <= toursMax; tour++) {
    // 1. Au dernier tour (s'il y en a eu d'autres avant), plus d'outil : une consigne le dit au LLM. Le budget de tokens
    // épuisé avance ce dernier tour
    const budgetEpuise = usage.entree + usage.sortie >= tokensMax;
    const dernier = tour > 1 && (tour === toursMax || budgetEpuise);
    if (dernier) {
      messages.push({ role: "utilisateur", texte: DERNIER_TOUR });
      yield { type: "limite", tour, raison: budgetEpuise ? "tokens" : "tours" };
    }
    // 2. Le LLM lit toute la conversation : la question, ses demandes précédentes et leurs résultats
    const reponse = await agent.llm(agent.systeme, messages, agent.outils, { sansOutil: dernier });
    ajouter(usage, reponse.usage);
    // 3. La recherche de secours : au premier tour, le LLM a répondu sans appeler aucun outil. Sa réponse est écartée (ses
    // tokens sont dépensés) ; le code cherche, et le LLM répond au tour suivant avec les passages
    if (recherche === "secours" && tour === 1 && reponse.appels.length === 0 && tour < toursMax) {
      yield* imposerRecherche(1, "recherche-de-secours");
      continue;
    }
    messages.push({ role: "assistant", texte: reponse.texte, appels: reponse.appels, brut: reponse.brut });
    // 4. Aucune demande d'appel : il a répondu. Au dernier tour, une demande n'est plus exécutée : la boucle répond à sa place
    if (reponse.appels.length === 0 || dernier || tour === toursMax) {
      const texte = reponse.appels.length === 0 ? reponse.texte : RECHERCHE_INACHEVEE;
      yield { type: "reponse", tour, texte, usage };
      return;
    }
    // 5. Sinon, chaque appel demandé est traité (un LLM peut en demander plusieurs à la fois)
    let refus = false;
    for (const appel of reponse.appels) {
      for await (const etape of traiter(appel, tour)) {
        if (etape.type === "resultat" && etape.statut === "refusé") refus = true;
        yield etape;
      }
    }
    // 6. Une action refusée : la boucle répond elle-même. Rendre la parole au LLM, c'est le laisser affirmer l'avoir faite
    if (refus) {
      yield { type: "reponse", tour, texte: "Je n'ai rien fait : vous n'avez pas confirmé l'action demandée.", usage };
      return;
    }
  }
}
