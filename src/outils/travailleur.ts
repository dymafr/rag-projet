// Le travailleur (chapitre 14, leçon 1) : le processus qui fait les tâches lentes de la file (src/taches/file.ts), à côté du
// serveur, qui reste libre de répondre. Il prend une tâche, la fait, recommence ; sans tâche, il attend d'être réveillé
// (NOTIFY à chaque ajout) ou, au plus tard, 30 secondes. Un seul travailleur : les tâches écrivent les mêmes fichiers
// (donnees/*.jsonl) et la même table, l'une après l'autre jamais en même temps
// Lancement : npm run travailleur (Ctrl+C : il finit sa tâche en cours, puis s'arrête)
import { spawn } from "node:child_process";
import { pool } from "../db.ts";
import { pourLeTerminal } from "../ingestion/secrets.ts";
import { creerFile, echouer, prendre, recuperer, terminer, type Tache } from "../taches/file.ts";

const ATTENTE_MS = 30_000;

// Une étape : un outil du projet, lancé comme on le lancerait à la main, avec le même environnement (DATABASE_URL…).
// --env-file-if-exists : en développement, .env ; dans un conteneur (leçon 10), il n'y en a pas, tout vient du compose.
// detached : l'étape a son propre groupe de processus, et le Ctrl+C du terminal n'atteint que le travailleur, qui la
// laisse finir (windowsHide : sous Windows, sans ouvrir de fenêtre à elle)
function etape(outil: string, args: string[] = []): Promise<void> {
  return new Promise((fini, echec) => {
    const enfant = spawn(process.execPath, ["--env-file-if-exists=.env", `src/outils/${outil}`, ...args], { detached: true, windowsHide: true });
    let sortie = "";
    let erreurs = "";
    enfant.stdout.on("data", (morceau) => (sortie += morceau));
    enfant.stderr.on("data", (morceau) => (erreurs += morceau));
    enfant.on("error", echec);
    enfant.on("close", (code) => {
      if (code !== 0) return echec(new Error(`${outil} a échoué (code ${code}) : ${erreurs.trim().slice(-2000)}`));
      console.log(`    ${outil} : ${sortie.trim().split("\n").at(-1) ?? ""}`);
      fini();
    });
  });
}

// Ce que fait chaque type de tâche
const FAIRE: Record<Tache["type"], (tache: Tache) => Promise<void>> = {
  // Réindexer : les trois étapes des chapitres 4 à 6, incrémentales (seuls les chunks nouveaux ou modifiés sont revectorisés)
  async reindexer() {
    await etape("ingest.ts");
    await etape("decouper.ts");
    await etape("indexer.ts");
  },
  // Effacer un document (chapitre 13) : son identifiant vient de la tâche, vérifié avant de devenir un argument
  async effacer(tache) {
    const id = String(tache.donnees.document ?? "");
    if (!/^[A-Z0-9-]{2,40}$/.test(id)) throw new Error(`identifiant de document invalide : ${id}`);
    await etape("effacer.ts", [id, ...(typeof tache.donnees.motif === "string" ? ["--motif", tache.donnees.motif] : [])]);
  },
};

await creerFile(pool);
const recuperees = await recuperer(pool);
if (recuperees > 0) console.log(`${recuperees} tâche(s) abandonnée(s) par un travailleur arrêté : remises en attente ou échouées`);

// Être réveillé dès qu'une tâche arrive : une connexion à soi, qui écoute le canal taches
const ecoute = await pool.connect();
let reveiller = () => {};
ecoute.on("notification", () => reveiller());
await ecoute.query("LISTEN taches");

let arreter = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log("Arrêt demandé : la tâche en cours se termine d'abord");
    arreter = true;
    reveiller();
  });
}
console.log("Le travailleur attend des tâches (npm run tache -- reindexer)");

while (!arreter) {
  const tache = await prendre(pool);
  if (!tache) {
    // Rien à faire : on regarde aussi les tâches abandonnées (par un travailleur relancé aussitôt, celle qu'il faisait
    // reste en_cours) ; passé le délai, elles reviennent
    const reprises = await recuperer(pool);
    if (reprises > 0) {
      console.log(`${reprises} tâche(s) abandonnée(s) par un travailleur arrêté : remises en attente ou échouées`);
      continue;
    }
    await new Promise<void>((suite) => {
      const minuterie = setTimeout(suite, ATTENTE_MS);
      reveiller = () => (clearTimeout(minuterie), suite());
    });
    continue;
  }
  const debut = performance.now();
  console.log(`Tâche ${tache.id} (${tache.type}, essai ${tache.essais}/${tache.max_essais})`);
  try {
    await FAIRE[tache.type](tache);
    await terminer(pool, tache.id);
    console.log(`  faite en ${((performance.now() - debut) / 1000).toFixed(1)} s`);
  } catch (erreur) {
    // Le détail reste dans le terminal et dans la table, caviardé (chapitre 13) : une erreur peut citer une clé
    const message = pourLeTerminal(erreur instanceof Error ? erreur.message : erreur).slice(0, 2000);
    await echouer(pool, tache, message);
    console.error(`  échec : ${message}`);
  }
}
ecoute.release();
await pool.end();
