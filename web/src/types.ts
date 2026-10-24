// Le contrat d'API entre le serveur de Rhéa et l'interface, décrit ici, sans rien importer du serveur : l'interface est
// livrée entière dès la leçon 1 du chapitre 14 et doit se construire à chaque commit, alors que le serveur grandit de
// leçon en leçon. Tout ce qui n'arrive qu'avec une leçon est facultatif (un champ optionnel, ou une route qui répond 404
// tant qu'elle n'existe pas) : l'interface fonctionne avec ou sans

export type Profil = "salarie" | "manager" | "rh";

// Un modèle : son fournisseur et son nom (« ollama », « gemma4:e4b »)
export type Modele = { fournisseur: string; modele: string };

// Les tokens d'un appel : entrée, dont relus dans le cache, sortie ; écrits dans le cache quand le fournisseur le dit
export type Usage = { entree: number; enCache: number; sortie: number; ecritCache?: number };

// Une étape de la trace d'une question : son nom stable (recherche-vectorielle, tour-llm…), son titre pour l'humain, son
// début et sa durée depuis le début de la question, son résumé, et son détail libre (chaque rendu le lit avec prudence)
export type EtapeTracee = {
  id: number;
  parent: number | null;
  nom: string;
  titre: string;
  debut_ms: number;
  duree_ms: number;
  statut: "ok" | "erreur";
  resume: string;
  details: Record<string, unknown>;
  usage?: Usage;
  modele?: Modele;
};

// Ce que le flux de POST /ask envoie pour une étape : son début, puis sa fin complète
export type EvenementTrace =
  | { type: "debut"; etape: Pick<EtapeTracee, "id" | "parent" | "nom" | "titre" | "debut_ms"> }
  | { type: "fin"; etape: EtapeTracee };

// Un passage dans une trace ou une réponse : de quoi le reconnaître et le classer
export type PassageEnBref = { id: string; document: string; titre: string; score: number };
export type SourceCitee = PassageEnBref & { texte: string };

// La fin d'une réponse. degrade (leçon 8) : aucun LLM n'a répondu, Rhéa a rendu les passages les plus proches ;
// observation (leçon 7) : l'identifiant de la question pour l'avis du salarié ; cache (leçon 6) : la réponse vient du
// cache sémantique, avec la similarité de la question qui l'avait reçue
export type Fin = {
  usage: Usage;
  cout: { min: number; max: number } | null;
  duree_ms: number;
  modele: Modele;
  prompt: string;
  tours: number;
  degrade?: boolean;
  observation?: string;
  cache?: number;
};

// Les routes d'inspection
export type FicheSalarie = { matricule: string; prenom: string; nom: string; role: Profil; site: string; service: string; poste: string };
export type DocumentIndexe = {
  document: string;
  titre: string;
  type: string;
  acces: string;
  langue: string;
  sites: string[] | null; // null avant que le serveur ne le garantisse
  date_effet: string;
  date_fin: string | null;
  passages: number;
  tokens: number;
};
export type PassageIndexe = { id: string; document: string; titres: string[]; texte: string; taille: number; type: string; acces: string; date_effet: string; date_fin: string | null };
export type Recherche = { passages: SourceCitee[]; trace: EtapeTracee[] };

export type Destination = { brique: string; ou: string; locale: boolean };
export type Tarifs = {
  date: string;
  source: string;
  modeles: Record<string, { entree: number; enCache: number; ecritureCache?: number; sortie: number }>;
  fileSearchPour1000: number;
};
export type Reglages = {
  mode: "vectorielle" | "plein-texte" | "hybride";
  candidats: number;
  poids: [number, number];
  vocabulaire: boolean;
  reclassement: boolean;
  reclasseur: "cross-encoder" | "llm";
  transformation: string | null;
  filtresExtraits: boolean;
  condensation: boolean;
  diversite: number | null;
};

// GET /api/configuration. Facultatifs : le repli de fournisseur (leçon 8), le plancher de similarité et la vérification
// de la réponse (leçon 4), le cache sémantique (leçon 6)
export type Configuration = {
  generation: Modele;
  repli?: Modele | null;
  juge: Modele;
  embeddings: { fournisseur: string; modele: string; dimensions: number | null; nom: string };
  reclasseur: { fournisseur?: string; modele: string; actif: boolean };
  recherche: Reglages;
  seuil: { valeur: number; plancher?: number | null; mesureAvec: string; aJour: boolean }; // plancher null : non mesuré
  budget: { passagesDemandes: number; tokens: number };
  agent: { toursMax: number; tokensMax: number; appelsParOutil: number; recherche: string; verification?: boolean };
  cache?: { actif: boolean; seuil: number };
  prompt: string;
  index: { passages: number; modele: string | null; stockage: string | null };
  destinations: Destination[];
  tarifs: Tarifs | null;
};

// Une affirmation de l'étape verification (leçon 4) : importante est facultatif (les exécutions plus anciennes ne l'ont
// pas) ; seule une affirmation importante non établie bloque la réponse, un détail non établi est seulement signalé
export type Affirmation = { affirmation: string; appuyee: boolean; raison: string; importante?: boolean };

// Les évaluations (leçon 2 ; avant, les routes répondent 404)
export type TypeDeQuestion = string;
export type Bilan = { reussies: number; jugees: number; total: number };
export type Critere = { critere: string; ok: boolean | null; raison: string };
export type Verdict = { reussie: boolean | null; criteres: Critere[] };
export type QuestionProduction = {
  id: string;
  question: string;
  type: TypeDeQuestion;
  categorie: string;
  profil: Profil;
  matricule: string;
  date: string;
  enVigueurLe?: string;
  historique?: { question: string; reponse: string }[];
  reponse?: string;
  passages?: Record<string, 1 | 2>;
  attendu?: string[];
  interdit?: string[];
  documents: string[];
  origine: string;
  note?: string;
};
export type ResultatQuestion = {
  question: QuestionProduction;
  obtenu: {
    texte: string;
    citees: string[];
    inventees: string[];
    passagesVus: string[];
    outils: string[];
    usage: Usage;
    cout: number | null;
    duree_ms: number;
    tours: number;
    erreur?: string;
  };
  verdict: Verdict;
  trace: EtapeTracee[];
};
export type ResumeExecution = {
  nom: string;
  jeu: "travail" | "cache";
  empreinteDuJeu: string;
  date: string;
  configuration: { generation: string; juge: string; embeddings: string; reclasseur: string | null; prompt: string; recherche: string };
  duree_ms: number;
  cout: number | null;
  bilan: Bilan & { parType: Record<string, Bilan>; parProfil: Record<string, Bilan>; parCategorie: Record<string, Bilan> };
};
export type QuestionEnBref = {
  id: string;
  question: string;
  type: string;
  categorie: string;
  profil: Profil;
  matricule: string;
  reussie: boolean | null;
  criteres: { critere: string; ok: boolean | null }[];
  duree_ms: number;
  cout: number | null;
  outils: string[];
  citees: number;
  inventees: number;
  erreur: boolean;
};
export type DetailExecution = { resume: ResumeExecution; questions: QuestionEnBref[] };

// Les désaccords entre deux juges et les étiquettes humaines (leçon 4) : GET /api/desaccords, POST /api/etiquettes
export type Desaccord = { id: string; question: string; reponse: string; empreinte: string; a: boolean | null; b: boolean | null; raisonsA: string[]; raisonsB: string[] };
export type Etiquette = { id: string; reponse: string; reussie: boolean; raison: string; date: string };
export type Desaccords = { desaccords: Desaccord[]; etiquettes: Etiquette[] };

// L'observabilité (leçon 7) : GET /api/observations
export type Jour = {
  jour: string;
  questions: number;
  sans_source: number;
  degradees: number;
  erreurs: number;
  latence_p50: number | null;
  latence_p95: number | null;
  cout: number | null;
  meilleur_score: number | null;
  retours_positifs: number;
  retours_negatifs: number;
};
export type Periode = { questions: number; sansSource: number | null; meilleurScore: number | null; negatifs: number | null };
export type Observations = { jours: Jour[]; derive: { recents: Periode; avant: Periode; alertes: string[] } };

// La santé du service (leçon 8) : GET /sante, présente même sans inspection
export type EtatDisjoncteur = "ferme" | "ouvert" | "demi-ouvert";
export type Sante = {
  ok: boolean;
  base?: boolean;
  llm?: { principal: Modele; repli: Modele | null };
  disjoncteurs?: { nom: string; etat: EtatDisjoncteur }[];
  questions?: { enCours: number; enAttente: number; max: number; attenteMax: number };
};

// Une étape vue par l'interface : terminée (celle de la trace), en cours (son seul début est arrivé), ou interrompue (la
// réponse s'est arrêtée avant sa fin : bouton Arrêter, erreur)
export type EtapeEnCours = Pick<EtapeTracee, "id" | "parent" | "nom" | "titre" | "debut_ms"> & { statut: "en-cours" | "interrompue" };
export type EtapeVue = EtapeTracee | EtapeEnCours;
export const estTerminee = (e: EtapeVue): e is EtapeTracee => e.statut === "ok" || e.statut === "erreur";
