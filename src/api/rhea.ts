// Ce que Rhéa fait pour une question, en événements prêts à envoyer : le texte au fil de l'écriture du LLM,
// puis les sources citées (vérifiées quand le LLM donne des extraits), et la fin
import { appuyee, horsCorpus, MESSAGE_ABSTENTION } from "../generation/abstention.ts";
import { numerosDesSources, verifierCitations } from "../generation/citations.ts";
import type { Citation, GenerateurEnFlux } from "../generation/generateur.ts";
import { assembler, estimerTokens } from "../generation/prompt.ts";
import type { PromptSysteme } from "../generation/systeme.ts";
import type { Usage } from "../llm.ts";
import type { Resultat } from "../recherche/vectorielle.ts";

// Ce dont Rhéa a besoin : en production, la base et le LLM de .env ; dans les tests, des faux
export type Dependances = {
  chercher: (question: string, date: string) => Promise<Resultat[]>;
  generer: GenerateurEnFlux;
  systeme: PromptSysteme;
  budget: number; // tokens réservés aux passages
  date: () => string; // la date du jour, AAAA-MM-JJ
};

export type Source = { numero: number; source: string; titre: string; extraits: { texte: string; trouvee: boolean }[] };
export type Evenement =
  | { nom: "texte"; donnees: { texte: string } }
  | { nom: "sources"; donnees: Source[] }
  | { nom: "abstention"; donnees: { message: string } }
  | { nom: "fin"; donnees: { usage: Usage | null; prompt: string } };

export async function* repondreEnFlux(question: string, dependances: Dependances, signal?: AbortSignal): AsyncGenerator<Evenement> {
  const { systeme, budget } = dependances;
  const versionDuPrompt = `v${systeme.version} ${systeme.empreinte}`;
  const date = dependances.date();
  // 1. Avant le LLM : une question trop loin de tous les passages, ou sans aucun passage gardé, n'est pas envoyée
  const resultats = await dependances.chercher(question, date);
  const prompt = assembler(question, resultats, { systeme: systeme.texte, budget, mesure: estimerTokens, date });
  if (horsCorpus(resultats) || prompt.passages.length === 0) {
    yield { nom: "abstention", donnees: { message: MESSAGE_ABSTENTION } };
    yield { nom: "fin", donnees: { usage: null, prompt: versionDuPrompt } };
    return;
  }
  // 2. Le texte, morceau par morceau, dès que le LLM l'écrit ; les citations sont gardées pour la fin
  let texte = "";
  const citations: Citation[] = [];
  let usage: Usage | null = null;
  for await (const morceau of dependances.generer(prompt, signal)) {
    if (morceau.type === "texte") {
      texte += morceau.texte;
      yield { nom: "texte", donnees: { texte: morceau.texte } };
    } else if (morceau.type === "citation") citations.push(morceau.citation);
    else usage = morceau.usage;
  }
  // 3. Les sources, une fois la réponse complète : on ne connaît qu'alors les passages cités
  const numeros = numerosDesSources(texte, citations, prompt.passages);
  const verifiees = verifierCitations(citations, prompt.passages);
  const sources = numeros.map((n) => ({
    numero: n,
    source: prompt.passages[n - 1].id,
    titre: prompt.passages[n - 1].titres.join(" > "),
    extraits: verifiees.filter((c) => c.numero === n).map((c) => ({ texte: c.texteCite, trouvee: c.trouvee })),
  }));
  yield { nom: "sources", donnees: sources };
  // 4. Le texte est déjà parti : si rien ne l'appuie, on demande à la page de le remplacer par le message d'abstention
  if (!appuyee(numeros, verifiees)) yield { nom: "abstention", donnees: { message: MESSAGE_ABSTENTION } };
  yield { nom: "fin", donnees: { usage, prompt: versionDuPrompt } };
}
