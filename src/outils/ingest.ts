// Ingestion de tout le corpus : chargement, métadonnées, dédoublonnage, puis écriture de donnees/documents.jsonl
// Lancement : npm run ingest
import { ingerer } from "../ingestion/pipeline.ts";

const debut = performance.now();
const bilan = await ingerer();
const duree = ((performance.now() - debut) / 1000).toFixed(1);

// Les identifiants concernés, quand ils sont peu nombreux
const detail = (ids: string[]) => (ids.length > 0 && ids.length <= 5 ? ` (${ids.join(", ")})` : "");
const { documents, nouveaux, modifies, supprimes } = bilan;
const inchanges = documents.length - nouveaux.length - modifies.length;
console.log(`${documents.length} documents écrits dans donnees/documents.jsonl en ${duree} s`);
console.log(`  nouveaux : ${nouveaux.length}${detail(nouveaux)}, modifiés : ${modifies.length}${detail(modifies)}, ` +
  `supprimés : ${supprimes.length}${detail(supprimes)}, inchangés : ${inchanges}`);
for (const source of bilan.doublons) console.log(`  Doublon écarté : ${source}`);
// Chapitre 13 : un ticket qui s'adresse à l'assistant attend qu'un humain le relise. On ne montre jamais son texte
for (const { id, regles } of bilan.quarantaine) console.log(`  En quarantaine : ${id} (${regles.join(", ")}), à relire avant de l'indexer`);
// Un secret caviardé reste un secret compromis : on le dit, sans jamais l'afficher
for (const { id, regles } of bilan.secrets) console.log(`  Secret caviardé : ${id} (${regles.join(", ")}), à révoquer auprès de son service`);
for (const id of bilan.effaces) console.log(`  Effacé : ${id}, écarté par le registre des effacements (à effacer aussi à la source)`);

// Une erreur n'arrête pas l'ingestion, mais elle se voit : message, journal et code de sortie
for (const { message } of bilan.erreurs) console.error(`  Erreur : ${message}`);
if (bilan.erreurs.length > 0) {
  console.error(`Fichiers en erreur : ${bilan.erreurs.length}, voir donnees/ingestion.log`);
  process.exitCode = 1;
}
