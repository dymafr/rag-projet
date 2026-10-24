// La boucle de l'agent. On envoie au LLM la question et la liste des outils ; tant qu'il demande des appels, notre code
// les exécute et lui renvoie les résultats ; quand il répond sans rien demander, c'est la réponse. Chaque étape est
// rendue au fil de l'eau (un générateur), pour que la ligne de commande ou le serveur l'affichent
import { z } from "zod";
import { finDuMessage } from "../generation/prompt.ts";
import { pourLeTerminal } from "../ingestion/secrets.ts";
import type { Usage } from "../llm.ts";
import type { Echange } from "../recherche/conversation.ts";
import type { Profil } from "../recherche/droits.ts";
import { apercu, enBref, etape, nombre, noter, pluriel, type Modele } from "../trace/trace.ts";
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

// Ce que la boucle écrit dans le journal pour chaque appel d'outil (leçon 5). Chapitre 13, leçon 4 : des références,
// jamais les données. Le journal (journal.ts) remplace le matricule par un pseudonyme avant d'écrire
export type Statut = "ok" | "erreur" | "refusé" | "limite";
export type EntreeJournal = {
  horodatage: string;
  matricule: string | null;
  profil: Profil; // les droits appliqués à la recherche
  tour: number;
  outil: string;
  champs: string[]; // le nom des arguments écrits par le LLM, pas leur valeur
  statut: Statut;
  motif?: "règle de deux" | "non confirmée"; // pour une action refusée
  duree_ms: number;
  passages: string[]; // les identifiants des passages rendus, pas leur texte
};

export type Recherche = "libre" | "office" | "secours";

// Chapitre 13, leçon 2 : la règle de deux. Une question ne doit pas réunir trois choses : un texte écrit par un tiers
// (un ticket), des données réservées, et une action. Rhéa lit des données réservées par nature : dès qu'un outil a
// rendu un texte non fiable, plus aucune action pour cette question. Une consigne cachée dans un ticket peut encore
// tromper le LLM ; elle ne peut plus rien lui faire faire. La boucle répond alors elle-même, comme après un refus
export const REGLE_DE_DEUX =
  "Je n'ai rien fait : une action m'a été demandée après la lecture d'un ticket, un texte écrit par un salarié, et " +
  "après un tel texte je n'en exécute aucune. Si vous vouliez cette action, demandez-la dans une nouvelle question.";

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
  modele?: Modele; // chapitre 14 : le fournisseur et le modèle du LLM, pour la trace de chaque tour
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
  if (usage.ecritCache !== undefined) total.ecritCache = (total.ecritCache ?? 0) + usage.ecritCache; // chapitre 14
};

// Chapitre 14 : un message de la conversation, tel que la trace le garde (le texte entier, les passages par leur source)
const enTrace = (m: Message) =>
  m.role === "outil"
    ? { role: m.role, nom: m.nom, texte: m.texte, passages: (m.passages ?? []).map((p) => p.id), erreur: m.erreur }
    : m.role === "assistant"
      ? { role: m.role, texte: m.texte, appels: m.appels }
      : { role: m.role, texte: m.texte };

// Une ligne pour la trace : ce qu'a donné un appel d'outil
function resumer({ resultat, erreur, statut }: Execution): string {
  if (statut === "refusé" || statut === "limite") return `${statut} : ${apercu(resultat.texte.replace(/\s+/g, " "), 120)}`;
  if (erreur) return `erreur : ${apercu(resultat.texte.replace(/\s+/g, " "), 120)}`;
  const passages = resultat.passages ?? [];
  if (passages.length > 0) return `${pluriel(passages.length, "passage")}, le premier ${passages[0].id} (${nombre(passages[0].score)})`;
  return apercu(resultat.texte.replace(/\s+/g, " "), 120);
}

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
  let nonFiableLu = false; // un outil a-t-il rendu un texte écrit par un tiers ?
  let bloquee = false; // une action a-t-elle été refusée par la règle de deux ?

  // Un appel d'outil : la limite d'appels, l'exécution (avec la confirmation s'il le faut), le journal, puis le résultat
  // ajouté à la conversation
  async function* traiter(appel: AppelOutil, tour: number): AsyncGenerator<Etape> {
    yield { type: "appel", tour, appel };
    const debut = performance.now();
    const n = (appelsFaits.get(appel.nom) ?? 0) + 1;
    appelsFaits.set(appel.nom, n);
    const connu = agent.outils.find((o) => o.nom === appel.nom);
    const action = connu?.aConfirmer !== undefined;
    // Chapitre 14 : l'appel devient une étape de la trace ; la recherche qu'il lance s'y range, comme ses enfants
    const execution = await etape(
      "outil",
      `Outil ${appel.nom}`,
      async (): Promise<Execution> => {
        if (n > appelsParOutil) {
          return { resultat: { texte: `Limite atteinte : ${appelsParOutil} appels de ${appel.nom} pour cette question. Répondez avec ce que vous avez.` }, erreur: true, statut: "limite" };
        }
        if (action && nonFiableLu) {
          bloquee = true; // la règle de deux : l'action n'est même pas proposée au salarié
          return { resultat: { texte: "Action refusée : un ticket a été lu pour cette question (règle de deux)." }, erreur: false, statut: "refusé", detail: "règle de deux : un ticket a été lu" };
        }
        return executer(appel, agent.outils, contexte, agent.confirmer);
      },
      (e) => ({
        resume: resumer(e),
        details: {
          tour,
          appel,
          statut: e.statut,
          erreur: e.erreur,
          ...(e.detail && { cause: pourLeTerminal(e.detail) }), // gardée hors du prompt, mais utile à qui inspecte
          nonFiable: e.resultat.nonFiable ?? false,
          passages: (e.resultat.passages ?? []).map(enBref),
          texte: e.resultat.texte, // ce que le LLM lira
        },
      }),
    );
    const { resultat, erreur, statut, detail } = execution;
    if (resultat.nonFiable) nonFiableLu = true;
    const duree = performance.now() - debut;
    const args = appel.arguments;
    await agent.journaliser?.({
      horodatage: new Date().toISOString(),
      matricule: contexte.matricule ?? null,
      profil: contexte.profil,
      tour,
      // Le nom de l'outil et ceux des arguments viennent du LLM : on ne garde que ce que l'outil déclare (chapitre 13)
      outil: connu ? appel.nom : "inconnu",
      champs: connu && typeof args === "object" && args !== null ? Object.keys(args).filter((c) => c in connu.parametres.shape) : [],
      statut,
      ...(statut === "refusé" && { motif: detail?.startsWith("règle de deux") ? ("règle de deux" as const) : ("non confirmée" as const) }),
      duree_ms: Math.round(duree),
      passages: (resultat.passages ?? []).map((p) => p.id),
    });
    yield { type: "resultat", tour, appel, resultat, erreur, statut, detail, duree };
    messages.push({ role: "outil", id: appel.id, nom: appel.nom, texte: resultat.texte, passages: resultat.passages, erreur });
  }

  // Une recherche imposée par le code. Elle entre dans la conversation comme si le LLM l'avait demandée
  async function* imposerRecherche(tour: number, id: string): AsyncGenerator<Etape> {
    const condenser = agent.condenser;
    const requete =
      historique.length > 0 && condenser
        ? await etape("condensation", "Condensation de la question", () => condenser(question, historique), (q) => ({
            resume: q === question ? "la question se comprend seule" : `« ${apercu(q, 140)} »`,
            details: { question, autonome: q, echanges: historique.length },
          }))
        : question;
    const appel: AppelOutil = { id, nom: "chercher_documents", arguments: { requete } };
    messages.push({ role: "assistant", texte: "", appels: [appel] });
    yield* traiter(appel, tour);
  }

  // Chapitre 14 : la trace garde ce que le LLM reçoit avant toute question, ses consignes et la liste de ses outils
  noter("prompt-systeme", "Consignes et outils du LLM", {
    resume: `${pluriel(agent.systeme.length, "caractère")} de consignes, ${pluriel(agent.outils.length, "outil")}`,
    details: { systeme: agent.systeme, outils: agent.outils.map((o) => ({ nom: o.nom, description: o.description, action: o.aConfirmer !== undefined })) },
  });
  // La fin de la question : la réponse, notée dans la trace avec le total des tokens
  const repondre = (tour: number, texte: string, raison: string): Etape => {
    noter("reponse", "Réponse", { resume: `${raison}, ${texte.length} caractères`, details: { tour, raison, texte, usage: { ...usage } } });
    return { type: "reponse", tour, texte, usage };
  };

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
      const raison = budgetEpuise ? "tokens" : "tours";
      noter("limite", "Dernier tour, sans outil", { resume: raison === "tokens" ? `budget de ${tokensMax} tokens atteint` : `${toursMax} tours au plus`, details: { tour, raison } });
      yield { type: "limite", tour, raison };
    }
    // 2. Le LLM lit toute la conversation : la question, ses demandes précédentes et leurs résultats. Chapitre 14 : le tour
    // se note dans la trace, avec la conversation telle qu'elle est partie et ce que le LLM a rendu
    const reponse = await etape(
      "tour-llm",
      `Tour ${tour} : le LLM`,
      () => agent.llm(agent.systeme, messages, agent.outils, { sansOutil: dernier }),
      (r) => ({
        resume: r.appels.length > 0 ? `demande ${r.appels.map((a) => a.nom).join(", ")}` : `répond (${r.texte.length} caractères)`,
        usage: r.usage,
        ...(agent.modele && { modele: agent.modele }),
        details: { tour, sansOutil: dernier, messages: messages.map(enTrace), appels: r.appels, texte: r.texte },
      }),
    );
    ajouter(usage, reponse.usage);
    // 3. La recherche de secours : au premier tour, le LLM a répondu sans appeler aucun outil. Sa réponse est écartée (ses
    // tokens sont dépensés) ; le code cherche, et le LLM répond au tour suivant avec les passages
    if (recherche === "secours" && tour === 1 && reponse.appels.length === 0 && tour < toursMax) {
      noter("recherche-de-secours", "Recherche de secours", {
        resume: "le LLM a répondu sans chercher : sa réponse est écartée, le code cherche à sa place",
        details: { reponseEcartee: reponse.texte },
      });
      yield* imposerRecherche(1, "recherche-de-secours");
      continue;
    }
    messages.push({ role: "assistant", texte: reponse.texte, appels: reponse.appels, brut: reponse.brut });
    // 4. Aucune demande d'appel : il a répondu. Au dernier tour, une demande n'est plus exécutée : la boucle répond à sa place
    if (reponse.appels.length === 0 || dernier || tour === toursMax) {
      yield reponse.appels.length === 0 ? repondre(tour, reponse.texte, "le LLM répond") : repondre(tour, RECHERCHE_INACHEVEE, "recherche inachevée");
      return;
    }
    // 5. Sinon, chaque appel demandé est traité (un LLM peut en demander plusieurs à la fois)
    let refus = false;
    for (const appel of reponse.appels) {
      for await (const e of traiter(appel, tour)) {
        if (e.type === "resultat" && e.statut === "refusé") refus = true;
        yield e;
      }
    }
    // 6. Une action refusée : la boucle répond elle-même. Rendre la parole au LLM, c'est le laisser affirmer l'avoir faite
    if (refus) {
      yield bloquee
        ? repondre(tour, REGLE_DE_DEUX, "action refusée (règle de deux)")
        : repondre(tour, "Je n'ai rien fait : vous n'avez pas confirmé l'action demandée.", "action non confirmée");
      return;
    }
  }
}
