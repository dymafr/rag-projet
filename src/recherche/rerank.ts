// Reclasser des passages (reranking) : un modèle lit la question et chaque passage ensemble, et donne à chacun une note de
// pertinence. C'est plus fin qu'une recherche, qui compare deux vecteurs calculés séparément, mais bien plus lent : on ne
// l'applique qu'aux quelques dizaines de candidats d'une première recherche, et l'on garde les meilleurs
import { AutoModelForSequenceClassification, AutoTokenizer, type PreTrainedModel, type PreTrainedTokenizer } from "@huggingface/transformers";
import { z } from "zod";
import { avecReprises } from "../embeddings/lots.ts";
import type { Llm } from "../llm.ts";
import { demanderJson } from "./llm-json.ts";
import { CANDIDATS_LLM } from "./reglages.ts";
import type { Resultat } from "./vectorielle.ts";

// Une note par passage, dans l'ordre des passages reçus : plus elle est haute, plus le passage est pertinent
export type Reclasseur = (question: string, passages: Resultat[]) => Promise<number[]>;

// Le texte que lit le modèle : le chemin de titres, puis le passage (le titre dit souvent de quoi parle un article)
export const aLire = (passage: Resultat) => `${passage.titres.join(" > ")}\n${passage.texte}`;

// 1. Un cross-encoder local, avec Transformers.js : la question et le passage forment une seule entrée, le modèle rend
// un nombre (un logit), que la sigmoïde ramène entre 0 et 1 : une note pour classer, pas une probabilité. Chargé au
// premier appel, puis gardé en mémoire
export function crossEncoder(modele: string, lot = 10): Reclasseur {
  const charger = () => Promise.all([AutoTokenizer.from_pretrained(modele), AutoModelForSequenceClassification.from_pretrained(modele, { dtype: "q8" })]);
  let charge: Promise<[PreTrainedTokenizer, PreTrainedModel]> | undefined;
  return async (question, passages) => {
    // Un chargement raté (réseau coupé) n'est pas gardé : le prochain appel le retente
    charge ??= charger().catch((erreur: unknown) => {
      charge = undefined;
      throw erreur;
    });
    const [tokenizer, cross] = await charge;
    const notes: number[] = [];
    for (let i = 0; i < passages.length; i += lot) {
      const textes = passages.slice(i, i + lot).map(aLire);
      // text_pair : chaque passage est lu avec la question ; truncation : une paire question + passage trop longue est
      // coupée à 512 tokens
      const entrees = tokenizer(textes.map(() => question), { text_pair: textes, padding: true, truncation: true, max_length: 512 });
      const { logits } = await cross(entrees);
      notes.push(...(logits.sigmoid().tolist() as number[][]).map(([note]) => note));
    }
    return notes;
  };
}

// 1 bis. Chapitre 14 : un reclasseur hébergé, celui de Voyage (rerank-3, rerank-3-lite). Le même principe que le
// cross-encoder local, un modèle plus grand, servi par une API : la question et les passages partent chez Voyage, qui
// rend une note de pertinence pour chacun (relevance_score), triée de la meilleure à la moins bonne, avec l'indice du
// passage. On la remet dans l'ordre reçu. Facturé à l'entrée : la question compte une fois par passage
const NotesVoyage = z.object({ data: z.array(z.object({ index: z.number().int(), relevance_score: z.number() })) });

export function reclasseurVoyage(modele: string, cle: string | undefined, base = "https://ai.mongodb.com/v1"): Reclasseur {
  return async (question, passages) => {
    if (passages.length === 0) return [];
    const lire = await avecReprises(async () => {
      const reponse = await fetch(`${base}/rerank`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: modele, query: question, documents: passages.map(aLire), truncation: true }),
      });
      // le statut HTTP reste sur l'erreur : avecReprises s'en sert pour décider d'un nouvel essai
      if (!reponse.ok) throw Object.assign(new Error(`Voyage : HTTP ${reponse.status} ${await reponse.text()}`), { status: reponse.status });
      return NotesVoyage.parse(await reponse.json());
    });
    const notes = passages.map(() => 0);
    for (const { index, relevance_score } of lire.data) if (index >= 0 && index < notes.length) notes[index] = relevance_score;
    return notes;
  };
}

// 2. Le LLM du projet, en un seul appel : il reçoit la question et les candidats numérotés, et rend leurs numéros du
// plus pertinent au moins pertinent (un classement par liste). Un candidat qu'il oublie passe après les autres, dans
// l'ordre de la recherche. Le prompt doit tenir dans la fenêtre de contexte du modèle : Ollama la fixe selon sa version
// et la mémoire de la carte graphique (4 096 tokens sur notre machine de référence), et retire sans erreur le début d'un
// prompt trop long, consigne comprise. D'où des passages coupés à LONGUEUR caractères, et CANDIDATS_LLM candidats au plus
// (20 passages : environ 3 300 tokens) ; les suivants restent derrière, dans l'ordre de la recherche
const LONGUEUR = 600;
const FORMAT_ORDRE = `Réponds uniquement avec un objet JSON : {"ordre": [numéros des passages, du plus utile au moins utile]}`;
const CONSIGNE_ORDRE = `Tu classes des passages de la documentation RH de Kalyo selon leur utilité pour répondre à la question d'un salarié.
Le plus utile est celui qui contient la réponse ; ensuite ceux qui aident ; en dernier ceux qui n'ont rien à voir. Ne réponds pas à la question.
${FORMAT_ORDRE}`;
const Ordre = z.object({ ordre: z.array(z.number().int()) });

// Chapitre 14 : un modèle hébergé lit les passages entiers (longueur Infinity). Coupé à 600 caractères, l'article sur le
// champ d'application de l'avenant télétravail perdait sa dernière phrase, la seule qui parle de grève
export function parLeLlm(llm: Llm, maximum = CANDIDATS_LLM, longueur = LONGUEUR): Reclasseur {
  return async (question, candidats) => {
    const passages = candidats.slice(0, maximum);
    const liste = passages.map((p, i) => `<passage numero="${i + 1}">\n${aLire(p).slice(0, longueur)}\n</passage>`).join("\n");
    const lu = await demanderJson(llm, CONSIGNE_ORDRE, `<question>\n${question}\n</question>\n\n<passages>\n${liste}\n</passages>`, Ordre, FORMAT_ORDRE);
    // Une note par candidat : le premier cité reçoit la plus haute ; un numéro inconnu ou répété est ignoré, sans faire
    // reculer les suivants. Les oubliés, et ceux au-delà du maximum, gardent 0 ou moins, dans l'ordre reçu
    const notes = candidats.map((_, i) => -i / candidats.length);
    const vus = new Set<number>();
    for (const numero of lu?.ordre ?? []) {
      if (numero < 1 || numero > passages.length || vus.has(numero)) continue;
      notes[numero - 1] = passages.length - vus.size;
      vus.add(numero);
    }
    return notes;
  };
}

// Reclasser : noter les passages, les trier par note, garder les k meilleurs. Le score de chaque passage reste sa
// similarité cosinus (le seuil d'abstention la compare) ; la note sert seulement à l'ordre. À note égale, l'ordre de la
// recherche décide
export async function reclasser(question: string, passages: Resultat[], reclasseur: Reclasseur, k: number): Promise<Resultat[]> {
  if (passages.length === 0) return [];
  const notes = await reclasseur(question, passages);
  return passages
    .map((passage, i) => ({ passage, note: notes[i] }))
    .sort((a, b) => b.note - a.note)
    .slice(0, k)
    .map(({ passage }) => passage);
}
