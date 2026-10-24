// Poser une question à l'agent Rhéa construit avec Mastra : l'outil chercher_documents du chapitre 10, le prompt de
// l'agent, et la boucle de Mastra. On affiche les appels d'outils, la réponse, les tokens et la durée
// Lancement : npm run mastra -- "Combien de jours de télétravail par semaine ?" [--date 2026-01-15]
import { parseArgs } from "node:util";
import { TOURS_MAX } from "../agent/boucle.ts";
import { chercherDocuments } from "../agent/chercher.ts";
import { pool } from "../db.ts";
import { nomDuModele } from "../embeddings/fournisseurs.ts";
import { agentMastra, reglagesMastra } from "../frameworks/mastra.ts";
import { plancherPour } from "../generation/abstention.ts";
import { PASSAGES_DEMANDES } from "../generation/prompt.ts";
import { lirePromptSysteme } from "../generation/systeme.ts";
import { aujourdhui, trouverPassages } from "../recherche/passages.ts";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { date: { type: "string", default: aujourdhui() } } });
const question = positionals.join(" ");
if (!question) throw new Error('Posez une question : npm run mastra -- "Combien de jours de télétravail par semaine ?"');

const recherche = chercherDocuments((requete, date, profil) => trouverPassages(pool, requete, PASSAGES_DEMANDES, profil, date), plancherPour(nomDuModele()));
const systeme = await lirePromptSysteme("prompts/rhea-agent.md");
// Aucun salarié connecté : le profil le plus restreint, les documents ouverts à tous (chapitre 13)
const agent = agentMastra([recherche], { date: values.date, profil: "salarie" }, systeme.texte);

try {
  const debut = performance.now();
  // maxSteps : le nombre de tours au plus, comme TOURS_MAX dans notre boucle
  const r = await agent.generate(question, { maxSteps: TOURS_MAX, ...reglagesMastra() });
  const secondes = ((performance.now() - debut) / 1000).toFixed(1);
  for (const appel of r.toolCalls) console.log(`Appel : ${appel.payload.toolName} ${JSON.stringify(appel.payload.args)}`);
  console.log(`\n${r.text.trim()}\n`);
  console.log(`${r.steps.length} tour(s), ${r.usage.inputTokens ?? 0} tokens en entrée, ${r.usage.outputTokens ?? 0} en sortie, ${secondes} s`);
} finally {
  await pool.end();
}
