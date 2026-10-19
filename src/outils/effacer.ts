// Effacer un document de Rhéa (chapitre 13, leçon 3) : l'inscrire au registre des effacements, le retirer tout de suite
// des fichiers dérivés et de la base, puis dire où il en reste des copies que cette commande ne peut pas effacer seule
// Lancement : npm run effacer -- TK-2026-0066 [--motif "demande d'effacement"] [--date 2026-10-19]
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DOSSIER_TEXTES } from "../agent/fichiers.ts";
import { pool } from "../db.ts";
import { FICHIER_STORE } from "../gere/store.ts";
import { aujourdhui } from "../recherche/passages.ts";
import { effacerDeLaBase, inscrire, retirerDuJsonl } from "../rgpd/effacements.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { motif: { type: "string", default: "demande d'effacement (article 17 du RGPD)" }, date: { type: "string", default: aujourdhui() } },
});
const id = positionals[0];
if (!id || !/^[A-Z0-9-]+$/.test(id)) {
  console.error("Attendu : l'identifiant d'un document, par exemple npm run effacer -- TK-2026-0066");
  process.exit(1);
}

// 1. Le registre d'abord : si la suite échoue, la prochaine ingestion écartera quand même le document
const nouveau = await inscrire({ id, date: values.date, motif: values.motif });
console.log(`Registre : ${id} ${nouveau ? "inscrit" : "déjà inscrit"} dans effacements.json`);

// 2. Les fichiers dérivés : les documents, les chunks, et l'export en Markdown du chapitre 10. L'accès du document se lit
// avant de le retirer : le store du chapitre 11 ne reçoit que les documents ouverts à tous
const lignes = (await readFile("donnees/documents.jsonl", "utf8").catch(() => "")).split("\n").filter(Boolean);
// undefined : le document n'y est plus (une commande relancée), son accès est inconnu
const acces = lignes.map((l) => JSON.parse(l) as { id: string; metadonnees: { acces: string } }).find((d) => d.id === id)?.metadonnees.acces;
const documents = await retirerDuJsonl("donnees/documents.jsonl", id);
const chunks = await retirerDuJsonl("donnees/chunks.jsonl", id);
const texte = join(DOSSIER_TEXTES, `${id}.md`);
const exporte = await rm(texte).then(() => true, () => false);
console.log(`Fichiers : ${documents} document et ${chunks} chunk(s) retirés de donnees/ ; ${exporte ? `${texte} supprimé` : "aucun export Markdown"}`);

// 3. La base : les chunks, puis VACUUM FULL, qui réécrit la table sans l'ancienne version des lignes (un DELETE la laisse
// sur le disque), et ANALYZE, qui refait les statistiques de l'optimiseur, où restent des valeurs (hors transaction)
let supprimes: string[] = [];
try {
  supprimes = await effacerDeLaBase(pool, id);
  await pool.query("VACUUM (FULL, ANALYZE) chunks");
  console.log(`Base : ${supprimes.length} chunk(s) supprimé(s)${supprimes.length ? ` (${supprimes.join(", ")})` : ""}, puis VACUUM FULL et ANALYZE`);
} finally {
  await pool.end();
}
if (nouveau && documents + chunks + supprimes.length === 0) {
  console.log(`Aucune copie de ${id} trouvée : vérifiez l'identifiant ; s'il est faux, retirez-le de effacements.json`);
}

// 4. Les copies hors de portée de cette commande : on les cherche, on les compte, on dit quoi faire
const mentions = async (dossier: string) => {
  const trouves: string[] = [];
  for (const nom of await readdir(dossier, { withFileTypes: true }).then((e) => e.filter((f) => f.isFile()).map((f) => f.name), () => [] as string[])) {
    const n = (await readFile(join(dossier, nom), "utf8")).split(id).length - 1;
    if (n > 0) trouves.push(`${nom} (${n})`);
  }
  return trouves;
};
const journal = await mentions("journal");
const traces = await mentions("eval/traces");
console.log("\nÀ effacer ailleurs :");
console.log("  la source : l'outil d'origine (ici, corpus/tickets/tickets.json) ; tant qu'il y reste, le registre l'écarte");
console.log(`  le journal de l'agent : ${journal.length ? journal.join(", ") : "aucune mention"}`);
console.log(`  les traces d'évaluation : ${traces.length ? traces.join(", ") : "aucune mention"}`);
const store = await readFile(FICHIER_STORE, "utf8").then(() => true, () => false);
const pourLeStore = acces === "tous" ? (store ? "npm run store:supprimer, puis store:creer (appels payants)" : "aucun store créé")
  : acces !== undefined ? "rien à faire, il ne reçoit que les documents ouverts à tous"
  : store ? "accès inconnu (le document n'est plus dans donnees/documents.jsonl) : vérifiez le store à la main" : "aucun store créé";
console.log(`  le store OpenAI du chapitre 11 : ${pourLeStore}`);
console.log("  les sauvegardes de la base : le document y reste jusqu'à leur rotation");
