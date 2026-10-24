// Où partent les données (chapitre 13, leçon 3) : pour chaque brique de Rhéa, la machine qui lit le texte des questions
// et des passages. Un modèle local les garde sur cette machine. Un fournisseur en ligne les reçoit : en général un
// sous-traitant ; s'il les traite hors de l'Espace économique européen, c'est un transfert, à encadrer (RGPD, chapitre V).
// Il suffit d'une seule brique pour que les données sortent : on les passe toutes en revue
import type { Config } from "../config.ts";

export type Destination = { brique: string; ou: string; locale: boolean };

const SERVEURS = { anthropic: "les serveurs d'Anthropic", openai: "les serveurs d'OpenAI", voyage: "les serveurs de Voyage AI" };

// Ollama sur cette machine, sur une autre, ou un modèle « cloud » (étiquette :cloud ou -cloud), exécuté chez Ollama
function parOllama(modele: string, url: string): Omit<Destination, "brique"> {
  if (/(?:^|[:-])cloud$/.test(modele)) return { ou: `les serveurs d'Ollama (modèle ${modele})`, locale: false };
  const hote = new URL(url).hostname;
  const ici = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hote);
  return ici ? { ou: `cette machine (Ollama, ${modele})`, locale: true } : { ou: `le serveur Ollama de ${hote} (${modele})`, locale: false };
}

export function destinations(c: Config): Destination[] {
  const llm = (brique: string, modele: string, fournisseur = c.LLM_PROVIDER): Destination =>
    fournisseur === "ollama" ? { brique, ...parOllama(modele, c.OLLAMA_BASE_URL) } : { brique, ou: `${SERVEURS[fournisseur]} (${modele})`, locale: false };
  const embeddings: Destination =
    c.EMBEDDING_PROVIDER === "transformers"
      ? { brique: "embeddings", ou: `cette machine (Transformers.js, ${c.EMBEDDING_MODEL})`, locale: true }
      : c.EMBEDDING_PROVIDER === "ollama"
        ? { brique: "embeddings", ...parOllama(c.EMBEDDING_MODEL, c.OLLAMA_BASE_URL) }
        : { brique: "embeddings", ou: `${SERVEURS[c.EMBEDDING_PROVIDER]} (${c.EMBEDDING_MODEL})`, locale: false };
  // Le modèle de vision passe toujours par Ollama (chapitre 12) ; sans VISION_MODEL, c'est LLM_MODEL si Ollama rédige
  const vision = c.VISION_MODEL ?? (c.LLM_PROVIDER === "ollama" ? c.LLM_MODEL : undefined);
  const base = new URL(c.DATABASE_URL.replace(/^postgres(ql)?:/, "http:")).hostname;
  return [
    llm("génération", c.LLM_MODEL),
    llm("juge d'évaluation", c.JUGE_MODEL || c.LLM_MODEL, c.JUGE_PROVIDER ?? c.LLM_PROVIDER), // chapitre 14 : son fournisseur à lui
    embeddings,
    // Chapitre 14, leçon 3 : avec CONTEXTUALISER=oui, npm run decouper envoie tout le corpus au LLM qui situe chaque passage
    // (leçon 5 : celui des étapes de la recherche)
    ...(c.CONTEXTUALISER ? [llm("contextualisation des passages", c.LLM_RECHERCHE_MODEL ?? c.LLM_MODEL, c.LLM_RECHERCHE_PROVIDER ?? c.LLM_PROVIDER)] : []),
    !c.RECLASSEMENT // chapitre 14, leçon 3 : sans reclassement, aucun passage ne part chez un reclasseur
      ? { brique: "reclassement", ou: "aucun (RECLASSEMENT=non)", locale: true }
      : c.RERANK_PROVIDER === "voyage"
      ? { brique: "reclassement", ou: `${SERVEURS.voyage} (${c.RERANK_MODEL})`, locale: false } // chapitre 14
      : c.RERANK_PROVIDER === "llm" // chapitre 14 : le LLM lui-même (leçon 5 : celui des étapes de la recherche)
        ? llm("reclassement", c.LLM_RECHERCHE_MODEL ?? c.LLM_MODEL, c.LLM_RECHERCHE_PROVIDER ?? c.LLM_PROVIDER)
        : { brique: "reclassement", ou: `cette machine (Transformers.js, ${c.RERANK_MODEL})`, locale: true },
    ...(c.LLM_RECHERCHE_MODEL ? [llm("filtres extraits et condensation", c.LLM_RECHERCHE_MODEL, c.LLM_RECHERCHE_PROVIDER)] : []),
    ...(vision ? [{ brique: "vision", ...parOllama(vision, c.OLLAMA_BASE_URL) }] : []),
    // Le RAG géré du chapitre 11 : les documents ouverts à tous, envoyés par npm run store:creer
    ...(c.FILE_SEARCH_MODEL ? [{ brique: "file_search (npm run store:…)", ou: `les serveurs d'OpenAI (${c.FILE_SEARCH_MODEL})`, locale: false }] : []),
    { brique: "base de données", ou: ["localhost", "127.0.0.1", "[::1]"].includes(base) ? "cette machine (PostgreSQL)" : `le serveur ${base}`, locale: ["localhost", "127.0.0.1", "[::1]"].includes(base) },
  ];
}
