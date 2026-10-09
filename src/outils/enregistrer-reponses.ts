// Poser à Rhéa les questions du jeu d'évaluation et enregistrer tout ce qu'il faut pour juger ses réponses ensuite :
// les passages trouvés, ceux envoyés au LLM, la réponse, les sources et l'abstention éventuelle
// Lancement : npm run eval:repondre -- [--sortie eval/reponses.json]
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { repondreEnFlux } from "../api/rhea.ts";
import { config } from "../config.ts";
import { pool } from "../db.ts";
import { nomDuModele } from "../embeddings/fournisseurs.ts";
import { lireJeu } from "../eval/jeu.ts";
import type { Enregistrement, ReponseEnregistree } from "../eval/reponses.ts";
import { creerGenerateurEnFlux } from "../generation/generateur.ts";
import { BUDGET_PASSAGES, PASSAGES_DEMANDES, type PromptAugmente } from "../generation/prompt.ts";
import { lirePromptSysteme } from "../generation/systeme.ts";
import { aujourdhui, trouverPassages } from "../recherche/passages.ts";
import type { Resultat } from "../recherche/vectorielle.ts";

const { values } = parseArgs({ options: { sortie: { type: "string", default: "eval/reponses.json" } } });
const systeme = await lirePromptSysteme();
const generer = creerGenerateurEnFlux();
const jour = aujourdhui();

const reponses: ReponseEnregistree[] = [];
for (const q of await lireJeu()) {
  // Rhéa telle qu'en production, avec un espion : il garde les passages trouvés, puis le prompt envoyé au LLM
  const espion: { trouves: Resultat[]; prompt?: PromptAugmente } = { trouves: [] };
  const debut = performance.now();
  const evenements = repondreEnFlux(q.question, {
    chercher: async (question, date) => {
      espion.trouves = await trouverPassages(pool, question, PASSAGES_DEMANDES, date);
      return espion.trouves;
    },
    generer: (prompt, signal) => {
      espion.prompt = prompt;
      return generer(prompt, signal);
    },
    systeme,
    budget: BUDGET_PASSAGES,
    date: () => q.date ?? jour,
  });
  let texte = "";
  let sources: ReponseEnregistree["sources"] = [];
  let abstention = false;
  for await (const e of evenements) {
    if (e.nom === "texte") texte += e.donnees.texte;
    else if (e.nom === "sources") sources = e.donnees.map(({ numero, source, extraits }) => ({ numero, source, extraits }));
    else if (e.nom === "abstention") abstention = true;
  }
  // Sans prompt, le LLM n'a pas été appelé : Rhéa s'est abstenue avant (score sous le seuil, ou aucun passage dans le budget)
  const appele = espion.prompt !== undefined;
  reponses.push({
    id: q.id,
    question: q.question,
    date: q.date ?? jour,
    trouves: espion.trouves.map((r) => ({ id: r.id, score: Number(r.score.toFixed(4)) })),
    passages: (espion.prompt?.passages ?? []).map((p, i) => ({ numero: i + 1, id: p.id, texte: p.texte })),
    texte,
    sources,
    abstention: !abstention ? null : appele ? "sans-source" : "avant-llm",
    duree: Math.round(performance.now() - debut),
  });
  const etat = !abstention ? `${sources.length} source(s)` : appele ? "abstention (sans source)" : "abstention (avant le LLM)";
  console.log(`${q.id}  ${etat.padEnd(26)} ${(reponses.at(-1)!.duree / 1000).toFixed(1)} s  ${q.question}`);
}
await pool.end();

const enregistrement: Enregistrement = {
  date: jour,
  llm: `${config.LLM_PROVIDER} ${config.LLM_MODEL}`,
  embeddings: nomDuModele(),
  prompt: `v${systeme.version} ${systeme.empreinte}`,
  reponses,
};
await writeFile(values.sortie, `${JSON.stringify(enregistrement, null, 2)}\n`);
console.log(`\n${reponses.length} réponses enregistrées dans ${values.sortie}`);
