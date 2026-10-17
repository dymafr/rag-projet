// Répondre avec l'outil file_search de l'API Responses : le modèle d'OpenAI cherche lui-même dans le vector store, lit
// les passages trouvés et répond en citant les fichiers. Une seule requête, là où Rhéa enchaîne recherche, prompt
// augmenté et génération (chapitres 6 et 7)
import type OpenAI from "openai";
import { usageDe } from "../generation/openai.ts";
import type { Usage } from "../llm.ts";
import type { Echange } from "../recherche/conversation.ts";
import type { Filtre } from "./store.ts";

const MAX_TOKENS = 4096; // voir generation/openai.ts : la réflexion d'un modèle qui raisonne compte dans cette limite

// Les réglages de l'outil, tous facultatifs sauf k
export type ReglagesFileSearch = {
  k: number; // max_num_results : les passages rendus au modèle, de 1 à 50
  seuil?: number; // score_threshold, de 0 à 1 : les passages sous ce score sont écartés
  hybride?: { embedding_weight: number; text_weight: number }; // les poids de la fusion RRF entre le sens et les mots
};

// Les poids de la recherche hybride à partir de la part des mots (de 0 à 1). En JavaScript, 1 - 0.7 vaut
// 0.30000000000000004 (les nombres à virgule sont stockés en binaire) : l'API refuse plus de 16 décimales, on arrondit
export const poidsHybrides = (poidsTexte: number) => ({ embedding_weight: Number((1 - poidsTexte).toFixed(4)), text_weight: poidsTexte });

export type Demande = { systeme: string; question: string; date: string; historique?: Echange[]; store: string; filtres?: Filtre };
export type PassageTrouve = { document: string; score: number; texte: string };
export type Citation = { document: string; index: number }; // index : la position, dans le texte, où insérer la citation
export type ReponseFileSearch = {
  texte: string;
  citations: Citation[];
  requetes: string[]; // les requêtes que le modèle a lancées : pas forcément la question telle quelle
  passages: PassageTrouve[];
  recherches: number; // les appels de l'outil, facturés à l'unité
  marqueurs: number; // les citations lues dans des marqueurs bruts du texte (voir lireMarqueurs)
  usage: Usage;
};

export async function repondreAvecFileSearch(client: OpenAI, modele: string, demande: Demande, reglages: ReglagesFileSearch): Promise<ReponseFileSearch> {
  const input: OpenAI.Responses.ResponseInputItem[] = [
    // Une question de suite : les échanges qui la précèdent, puis la question
    ...(demande.historique ?? []).flatMap((e) => [
      { role: "user" as const, content: e.question },
      { role: "assistant" as const, content: e.reponse },
    ]),
    { role: "user", content: `Date du jour : ${demande.date}\n\nQuestion : ${demande.question}` },
  ];
  const reponse = await client.responses.create({
    model: modele,
    instructions: demande.systeme,
    input,
    tools: [
      {
        type: "file_search",
        vector_store_ids: [demande.store],
        max_num_results: reglages.k,
        ...(demande.filtres && { filters: demande.filtres }),
        ranking_options: {
          ranker: "auto",
          ...(reglages.seuil !== undefined && { score_threshold: reglages.seuil }),
          ...(reglages.hybride && { hybrid_search: reglages.hybride }),
        },
      },
    ],
    include: ["file_search_call.results"], // sans cela, la réponse ne contient pas les passages trouvés
    max_output_tokens: MAX_TOKENS,
    store: false, // sinon OpenAI garde la réponse ; les documents, eux, restent dans le store
  });
  // Les mêmes contrôles que pour Rhéa (generation/openai.ts) : une réponse coupée ou un refus ne passent pas pour une réponse
  if (reponse.status !== "completed") {
    throw new Error(`Réponse ${reponse.status ?? "inconnue"} : ${reponse.incomplete_details?.reason ?? reponse.error?.message ?? "raison inconnue"}`);
  }
  const contenus = reponse.output.flatMap((sortie) => (sortie.type === "message" ? sortie.content : []));
  const refus = contenus.find((c) => c.type === "refusal");
  if (refus) throw new Error(`Refus du modèle : ${refus.refusal}`);

  // Les appels de l'outil : les requêtes lancées et, grâce à include, les passages trouvés avec leurs attributs
  const appels = reponse.output.flatMap((sortie) => (sortie.type === "file_search_call" ? [sortie] : []));
  const parAppel = appels.map((a) =>
    (a.results ?? []).map((r) => ({ document: String(r.attributes?.document ?? r.filename ?? "?"), score: r.score ?? 0, texte: r.text ?? "" })),
  );
  const passages = parAppel.flat();
  // Le texte et ses citations. Une citation donne le fichier et une position dans son morceau de texte : on la ramène
  // à une position dans le texte entier
  let texte = "";
  const citations: Citation[] = [];
  for (const c of contenus) {
    if (c.type !== "output_text") continue;
    for (const a of c.annotations) {
      if (a.type === "file_citation") citations.push({ document: a.filename.replace(/\.md$/, ""), index: texte.length + a.index });
    }
    texte += c.text;
  }
  // Il arrive que le modèle écrive ses citations en marqueurs bruts dans le texte, au lieu de les rendre en annotations
  // (défaut signalé plusieurs fois sur le forum d'OpenAI, revenu après un correctif annoncé en juin 2026) : on retire ces
  // marqueurs et on les lit comme des citations
  const lus = lireMarqueurs(texte, parAppel);
  return {
    texte: lus.texte,
    citations: [...citations.map((c) => ({ ...c, index: lus.decaler(c.index) })), ...lus.citations],
    requetes: appels.flatMap((a) => a.queries),
    passages,
    recherches: appels.length,
    marqueurs: lus.citations.length,
    usage: usageDe(reponse.usage),
  };
}

// Un marqueur brut : « U+E200 filecite U+E202 turn0file1 U+E202 turn0file3 U+E201 ». Les caractères U+E200 à U+E202
// appartiennent à une zone Unicode à usage privé : ils ne s'affichent pas, ou en carré. Un marqueur d'une autre forme
// (une autre sorte de citation) est retiré lui aussi, sans être lu
const MARQUEUR = /\uE200([^\uE200\uE201]*)\uE201/g;

// On retire chaque marqueur du texte et on garde ses références comme citations, au même endroit. turnKfileN : le
// passage numéro N du K-ième appel de l'outil, comptés à partir de 0 (si l'appel n'existe pas, le N-ième de tous les
// passages) ; c'est ce que montrent nos réponses, toutes à un seul appel (le contenu cité correspond) ; aucune règle
// documentée. decaler ramène une position du texte d'origine dans le texte sans marqueurs
export function lireMarqueurs(texte: string, parAppel: PassageTrouve[][]) {
  const tous = parAppel.flat();
  const citations: Citation[] = [];
  const retraits: { index: number; longueur: number }[] = [];
  let propre = "";
  let dernier = 0;
  for (const m of texte.matchAll(MARQUEUR)) {
    propre += texte.slice(dernier, m.index);
    const references = m[1].startsWith("filecite") ? m[1].matchAll(/turn(\d+)file(\d+)/g) : [];
    for (const [, tour, n] of references) {
      const passage = (parAppel[Number(tour)] ?? tous)[Number(n)];
      if (passage) citations.push({ document: passage.document, index: propre.length });
    }
    retraits.push({ index: m.index, longueur: m[0].length });
    dernier = m.index + m[0].length;
  }
  propre += texte.slice(dernier);
  const decaler = (i: number) => i - retraits.filter((r) => r.index < i).reduce((s, r) => s + r.longueur, 0);
  return { texte: propre, citations, decaler };
}

// Les citations ne sont pas dans le texte : on les y insère entre crochets, comme les sources de Rhéa, mais au niveau du
// document ([POL-TT-02]) : OpenAI ne dit pas quel passage il cite. Une même source citée deux fois au même endroit
// n'apparaît qu'une fois
export function avecCitations(texte: string, citations: Citation[]): string {
  const parPosition = new Map<number, Set<string>>();
  for (const c of citations) parPosition.set(c.index, (parPosition.get(c.index) ?? new Set()).add(c.document));
  let resultat = texte;
  // De la fin vers le début : une insertion ne décale pas les positions qui restent à traiter
  for (const [index, documents] of [...parPosition].sort(([a], [b]) => b - a)) {
    const marques = [...documents].map((d) => `[${d}]`).join("");
    resultat = resultat.slice(0, index) + marques + resultat.slice(index);
  }
  return resultat;
}
