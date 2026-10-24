// Lancer le serveur de Rhéa : l'interface sur http://localhost:3000, et POST /ask pour les programmes
// Lancement : npm run serveur (Ctrl+C pour l'arrêter). npm run serveur construit d'abord l'interface (web/ → web/dist)
// Chapitre 14 : le serveur sert l'agent complet, celui de npm run agent et de l'évaluation, assemblé une seule fois
import { journalJsonl } from "../agent/journal.ts";
import { assemblerRhea, outilsDeRhea, PROMPT_AGENT } from "../agent/rhea.ts";
import { Confirmations } from "../api/confirmations.ts";
import { inspectionDe } from "../api/inspection.ts";
import { creerServeur } from "../api/serveur.ts";
import { config } from "../config.ts";
import { pool } from "../db.ts";
import { nomDuModele } from "../embeddings/fournisseurs.ts";
import { lireTarifs } from "../eval/comparaison.ts";
import { MODELE_DU_SEUIL } from "../generation/abstention.ts";
import { lirePromptSysteme } from "../generation/systeme.ts";
import { profilDuSalarie } from "../recherche/droits.ts";
import { aujourdhui } from "../recherche/passages.ts";

const PORT = Number(process.env.PORT ?? 3000);
if (nomDuModele() !== MODELE_DU_SEUIL) {
  console.warn(`Attention : le seuil d'abstention a été mesuré avec ${MODELE_DU_SEUIL}, pas avec ${nomDuModele()}. Relancez npm run seuils`);
}
const systeme = await lirePromptSysteme(PROMPT_AGENT);
const version = `v${systeme.version} ${systeme.empreinte}`;
const tarifs = await lireTarifs();
const outils = outilsDeRhea(pool); // créés une fois ; chaque question assemble son agent, pour son salarié
const journaliser = journalJsonl(); // chaque appel d'outil au journal, pseudonymisé (chapitre 13)
const serveur = creerServeur({
  agent: (session, confirmer) => assemblerRhea(outils, { systeme: systeme.texte, matricule: session.matricule, confirmer, journaliser }),
  confirmations: new Confirmations(),
  profil: (matricule) => profilDuSalarie(pool, matricule), // chapitre 13 : l'annuaire dit qui peut lire quoi
  date: aujourdhui,
  version,
  tarifs,
  inspection: config.INSPECTION,
  inspecter: config.INSPECTION ? inspectionDe(pool, { version, tarifs }) : undefined,
  web: "web/dist",
});
// 127.0.0.1 : le serveur ne répond qu'à cette machine, pas au reste du réseau
serveur.listen(PORT, "127.0.0.1", () => {
  const mode = config.INSPECTION ? "mode inspection : chaque étape est visible dans l'interface" : "inspection désactivée";
  console.log(`Rhéa écoute sur http://localhost:${PORT} (prompt ${version}, ${config.LLM_PROVIDER} ${config.LLM_MODEL}, ${mode})`);
});
