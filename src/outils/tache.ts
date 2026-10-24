// Inscrire une tâche dans la file (chapitre 14, leçon 1), ou voir où en est la file. Le travailleur la fera
// Lancement : npm run tache -- reindexer
//             npm run tache -- effacer TK-2026-0066 [--motif "demande d'effacement"]
//             npm run tache -- etat
import { parseArgs } from "node:util";
import { pool } from "../db.ts";
import { ajouter, creerFile, etatDeLaFile } from "../taches/file.ts";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { motif: { type: "string" } } });
const [commande, document] = positionals;
await creerFile(pool);
try {
  if (commande === "reindexer") {
    console.log(`Tâche ${await ajouter(pool, "reindexer")} inscrite : réindexer le corpus`);
  } else if (commande === "effacer") {
    if (!document || !/^[A-Z0-9-]{2,40}$/.test(document)) throw new Error("Attendu : npm run tache -- effacer <identifiant du document>");
    console.log(`Tâche ${await ajouter(pool, "effacer", { document, ...(values.motif && { motif: values.motif }) })} inscrite : effacer ${document}`);
  } else if (commande === "etat") {
    const { comptes, dernieres } = await etatDeLaFile(pool);
    console.log(`En attente ${comptes.en_attente ?? 0}, en cours ${comptes.en_cours ?? 0}, faites ${comptes.faite ?? 0}, échouées ${comptes.echouee ?? 0}`);
    for (const t of dernieres) console.log(`  ${String(t.id).padStart(4)}  ${t.type.padEnd(10)} ${t.etat.padEnd(11)} essais ${t.essais}/${t.max_essais}${t.erreur ? `  ${t.erreur.slice(0, 80)}` : ""}`);
  } else {
    throw new Error("Attendu : npm run tache -- reindexer | effacer <document> | etat");
  }
} finally {
  await pool.end();
}
