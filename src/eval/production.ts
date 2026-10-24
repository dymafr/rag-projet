// Le jeu d'évaluation de la production (chapitre 14, leçon 2) et ce qu'une exécution en garde. Un seul schéma pour toutes
// les questions : documentaires, refus et abstentions, données structurées, documents scannés, et pour les deux jeux, le
// jeu de travail (on règle Rhéa dessus) et le jeu caché (on ne s'en sert que pour vérifier, leçon 5)
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Usage } from "../llm.ts";
import { PROFILS } from "../recherche/droits.ts";
import type { EtapeTracee } from "../trace/trace.ts";

export const TYPES = [
  "un-passage",
  "plusieurs-passages",
  "date-version",
  "conversation",
  "hors-corpus",
  "interdite",
  "donnees-structurees",
  "document-scanne",
  "multilingue",
] as const;
export type TypeDeQuestion = (typeof TYPES)[number];

// Combien de questions de chaque type, dans le jeu de travail (240) et dans le jeu caché (160) : les mêmes proportions,
// pour que le jeu caché mesure la même chose (leçon 2, npm run eval:taille pour le choix des tailles)
export const QUOTAS: Record<TypeDeQuestion, { travail: number; cache: number }> = {
  "un-passage": { travail: 80, cache: 54 },
  "plusieurs-passages": { travail: 30, cache: 20 },
  "date-version": { travail: 20, cache: 13 },
  conversation: { travail: 20, cache: 13 },
  "hors-corpus": { travail: 30, cache: 20 },
  interdite: { travail: 20, cache: 14 },
  "donnees-structurees": { travail: 30, cache: 20 },
  "document-scanne": { travail: 4, cache: 2 },
  multilingue: { travail: 6, cache: 4 },
};

const Motifs = z.array(
  z.string().refine((motif) => {
    try {
      new RegExp(motif, "iu");
      return true;
    } catch {
      return false;
    }
  }, "expression régulière invalide"),
).min(1);
const Jour = z.iso.date();

export const QuestionProduction = z
  .strictObject({
    id: z.string().regex(/^(Q\d{2,}|[LRSV]\d|H\d{3})$/, "identifiant attendu : Q63, R4, H001…"),
    question: z.string().trim().min(1),
    type: z.enum(TYPES),
    categorie: z.enum(["couverte", "hors-corpus", "interdite"]),
    profil: z.enum(PROFILS),
    matricule: z.string().regex(/^K\d{4}$/),
    date: Jour, // la date du jour pour Rhéa
    enVigueurLe: Jour.optional(), // la date dont parle la question, quand ce n'est pas aujourd'hui
    historique: z.array(z.strictObject({ question: z.string().min(1), reponse: z.string().min(1) })).min(1).optional(),
    reponse: z.string().min(1).optional(), // la réponse de référence d'une question couverte
    passages: z.record(z.string(), z.union([z.literal(1), z.literal(2)])).optional(), // 2 : il répond ; 1 : il aide
    attendu: Motifs.optional(), // ce que la réponse doit contenir (une valeur exacte)
    interdit: Motifs.optional(), // ce qu'elle ne doit jamais contenir
    documents: z.array(z.string()),
    origine: z.enum(["ecrite", "synthetique", "reprise"]),
    note: z.string().optional(),
  })
  .superRefine((q, ctx) => {
    const attendue = q.type === "hors-corpus" || q.type === "interdite" ? q.type : "couverte";
    if (q.categorie !== attendue) ctx.addIssue({ code: "custom", path: ["categorie"], message: `${q.type} attend la catégorie ${attendue}` });
    if (q.categorie === "couverte" && !q.reponse && !q.attendu) ctx.addIssue({ code: "custom", path: ["reponse"], message: "une question couverte a une réponse de référence ou des motifs attendus" });
    if (q.categorie !== "couverte" && (q.reponse || q.passages)) ctx.addIssue({ code: "custom", path: ["categorie"], message: "une question sans réponse n'a ni réponse de référence ni passages" });
    if (q.type === "conversation" && !q.historique) ctx.addIssue({ code: "custom", path: ["historique"], message: "une question de suite a son historique" });
  });
export type QuestionProduction = z.infer<typeof QuestionProduction>;

export const JeuProduction = z.array(QuestionProduction).superRefine((questions, ctx) => {
  const vues = new Set<string>();
  for (const [i, q] of questions.entries()) {
    if (vues.has(q.id)) ctx.addIssue({ code: "custom", path: [i, "id"], message: `identifiant en double : ${q.id}` });
    vues.add(q.id);
  }
});

export const JEU_DE_TRAVAIL = "eval/production/travail.json";
export const JEU_CACHE = "eval/production/cache.json";

// L'empreinte d'un jeu : SHA-256 du fichier tel qu'il est écrit. Notée au moment où le jeu caché est figé (leçon 2), elle
// prouve ensuite qu'il n'a pas changé : une question retouchée pour faire passer Rhéa changerait l'empreinte
export const empreinteDe = (contenu: string | Buffer) => createHash("sha256").update(contenu).digest("hex");

export async function lireJeuProduction(fichier = JEU_DE_TRAVAIL): Promise<{ questions: QuestionProduction[]; empreinte: string }> {
  const contenu = await readFile(fichier, "utf8");
  // Le jeu caché, que personne ne doit lire en réglant Rhéa : une erreur n'en montre rien, ni l'extrait que cite l'erreur
  // de JSON.parse, ni une clé de passage (le chemin d'une erreur la contient), ni un identifiant ; seulement l'indice de
  // la question et son champ
  const cache = fichier === JEU_CACHE;
  let brut: unknown;
  try {
    brut = JSON.parse(contenu);
  } catch (erreur) {
    throw new Error(cache ? `${fichier} : JSON invalide` : `${fichier} : ${(erreur as Error).message}`);
  }
  const lu = JeuProduction.safeParse(brut);
  if (!lu.success) {
    const lignes = lu.error.issues.map((i) => (cache ? `  ${i.path.slice(0, 2).join(".")} : invalide` : `  ${i.path.join(".")} : ${i.message}`));
    throw new Error(`${fichier} invalide :\n${lignes.join("\n")}`);
  }
  return { questions: lu.data, empreinte: empreinteDe(contenu) };
}

// Le verdict d'une question : chaque critère, et la raison du juge quand il y en a un
export type Critere = { critere: "exactitude" | "fidelite" | "refus" | "attendu" | "interdit"; ok: boolean | null; raison: string };
export type Verdict = { reussie: boolean | null; criteres: Critere[] }; // null : non jugée (juge illisible, réponse en échec)

// Ce qu'une exécution garde d'une question : la question et ce qu'on attendait, ce que Rhéa a fait (sa réponse, ses
// sources, ses tokens, toute sa trace) et le verdict
export type ResultatQuestion = {
  question: QuestionProduction;
  obtenu: {
    texte: string;
    citees: string[];
    inventees: string[];
    passagesVus: string[]; // tous les passages rendus par les outils, dans l'ordre
    lus?: { id: string; texte: string }[]; // leur texte, pour rejuger sans relancer Rhéa (leçon 4)
    outils: string[]; // les outils appelés, dans l'ordre
    usage: Usage;
    cout: number | null;
    duree_ms: number;
    tours: number;
    erreur?: string; // la question a échoué (outil, LLM) : caviardée
  };
  verdict: Verdict;
  trace: EtapeTracee[];
};

export type Bilan = { reussies: number; jugees: number; total: number };
export type Execution = {
  nom: string;
  jeu: "travail" | "cache";
  empreinteDuJeu: string;
  date: string; // le jour de l'exécution
  configuration: { generation: string; juge: string; embeddings: string; reclasseur: string | null; prompt: string; recherche: string };
  duree_ms: number;
  cout: number | null;
  bilan: Bilan & { parType: Record<string, Bilan>; parProfil: Record<string, Bilan>; parCategorie: Record<string, Bilan> };
  resultats: ResultatQuestion[];
};

// Les comptes d'un ensemble de résultats : réussies, jugées (un verdict, réussi ou non), et le total
export function compter(resultats: ResultatQuestion[]): Bilan {
  return {
    reussies: resultats.filter((r) => r.verdict.reussie === true).length,
    jugees: resultats.filter((r) => r.verdict.reussie !== null).length,
    total: resultats.length,
  };
}

export function bilanDe(resultats: ResultatQuestion[]): Execution["bilan"] {
  const par = (cle: (r: ResultatQuestion) => string) => {
    const groupes = new Map<string, ResultatQuestion[]>();
    for (const r of resultats) groupes.set(cle(r), [...(groupes.get(cle(r)) ?? []), r]);
    return Object.fromEntries([...groupes].map(([k, liste]) => [k, compter(liste)]));
  };
  return { ...compter(resultats), parType: par((r) => r.question.type), parProfil: par((r) => r.question.profil), parCategorie: par((r) => r.question.categorie) };
}
