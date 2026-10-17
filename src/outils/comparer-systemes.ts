// Mettre des systèmes côte à côte (chapitre 11, leçon 4), une fois chacun jugé par npm run eval:agent:juger : questions
// réussies, durée, tokens et coût, puis, question par question, ce que chacun gagne ou perd par rapport au premier
// fichier, avec McNemar (chapitre 8). Les coûts viennent des tarifs datés de eval/tarifs.json
// Lancement : npm run eval:comparer -- eval/traces/maison.json eval/traces/langchain.json eval/traces/file-search.json
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { bilanAgent, reussie, type FichierAgent, type VerdictsAgent } from "../eval/agent.ts";
import { centile, cout, lireTarifs } from "../eval/comparaison.ts";

const { positionals: fichiers } = parseArgs({ allowPositionals: true });
if (fichiers.length < 2) throw new Error("Donnez au moins deux fichiers de traces jugées : npm run eval:comparer -- eval/traces/maison.json eval/traces/langchain.json");

const tarifs = await lireTarifs();
const lire = async (f: string) => JSON.parse(await readFile(f, "utf8"));
const systemes = [];
for (const f of fichiers) {
  const traces = (await lire(f)) as FichierAgent;
  const juge = f.replace(/(\.json)?$/, "-juge.json");
  const { verdicts } = (await lire(juge).catch(() => {
    throw new Error(`${juge} introuvable : jugez d'abord avec npm run eval:agent:juger -- --traces ${f}`);
  })) as { verdicts: VerdictsAgent[] };
  const llm = traces.llm ?? "?";
  const couts = traces.traces.map((t) => cout(t.usage ?? { entree: t.tokens, enCache: 0, sortie: 0 }, t.recherchesFacturees ?? 0, llm, tarifs));
  // Seul un modèle local (Ollama) peut être sans tarif : un modèle hébergé absent de eval/tarifs.json fausserait le coût
  if (couts.some((c) => c === null) && !llm.startsWith("ollama ")) {
    throw new Error(`« ${llm} » n'a pas de tarif dans eval/tarifs.json : ajoutez-le, écrit comme le champ llm des traces`);
  }
  const moyenne = (liste: number[]) => liste.reduce((s, n) => s + n, 0) / Math.max(1, liste.length);
  systemes.push({
    nom: basename(f, ".json"), // le fichier de traces : maison et maison-openai se distinguent
    llm,
    verdicts,
    reussies: verdicts.filter(reussie).length,
    total: verdicts.length,
    p50: centile(traces.traces.map((t) => t.secondes), 50),
    p95: centile(traces.traces.map((t) => t.secondes), 95),
    entree: Math.round(moyenne(traces.traces.map((t) => t.usage?.entree ?? t.tokens))),
    sortie: Math.round(moyenne(traces.traces.map((t) => t.usage?.sortie ?? 0))),
    // Pour 1 000 questions, en dollars, en fourchette ; null : un modèle local, sans coût par token
    cout: couts.some((c) => c === null)
      ? null
      : { min: 1000 * moyenne(couts.map((c) => c!.min)), max: 1000 * moyenne(couts.map((c) => c!.max)) },
  });
}

console.log(`Tarifs du ${tarifs.date} (${tarifs.source})\n`);
console.log(`${"système".padEnd(14)} ${"réussies".padEnd(9)} ${"médiane".padStart(8)} ${"95e c.".padStart(7)} ${"entrée".padStart(7)} ${"sortie".padStart(7)}  coût pour 1 000 questions`);
for (const s of systemes) {
  const c =
    s.cout === null
      ? "local, sans coût par token"
      : s.cout.max.toFixed(2) === s.cout.min.toFixed(2)
        ? `${s.cout.min.toFixed(2)} $`
        : `${s.cout.min.toFixed(2)} à ${s.cout.max.toFixed(2)} $`;
  console.log(
    `${s.nom.padEnd(14)} ${`${s.reussies}/${s.total}`.padEnd(9)} ${`${s.p50.toFixed(1)} s`.padStart(8)} ${`${s.p95.toFixed(1)} s`.padStart(7)} ${String(s.entree).padStart(7)} ${String(s.sortie).padStart(7)}  ${c}`,
  );
}

if (systemes.some((s) => s.cout && s.cout.max.toFixed(2) !== s.cout.min.toFixed(2))) {
  console.log("\nFourchette : les traces ne disent pas combien de tokens ont été écrits dans le cache, facturés plus cher que l'entrée ;");
  console.log("le haut suppose que toute l'entrée non relue dans le cache a été écrite.");
}

// Question par question, par rapport au premier système : celles que l'autre réussit en plus (gagnées) ou en moins (perdues)
const [premier, ...autres] = systemes;
const reference = new Map(premier.verdicts.map((v) => [v.id, reussie(v)]));
console.log(`\nPar rapport à ${premier.nom} :`);
for (const s of autres) {
  const { gagnees, perdues, p } = bilanAgent(s.verdicts, reference).comparaison!;
  console.log(`  ${s.nom} : ${gagnees.length} gagnées (${gagnees.join(", ") || "aucune"}), ${perdues.length} perdues (${perdues.join(", ") || "aucune"}), McNemar p = ${p.toFixed(3)}`);
}
console.log("\nModèles :");
for (const s of systemes) console.log(`  ${s.nom} : ${s.llm}`);
