// Lancer le serveur de Rhéa : la page de chat sur http://localhost:3000, et POST /ask pour les programmes
// Lancement : npm run serveur (Ctrl+C pour l'arrêter)
import { creerServeur } from "../api/serveur.ts";
import { pool } from "../db.ts";
import { nomDuModele } from "../embeddings/fournisseurs.ts";
import { MODELE_DU_SEUIL } from "../generation/abstention.ts";
import { creerGenerateurEnFlux } from "../generation/generateur.ts";
import { BUDGET_PASSAGES, PASSAGES_DEMANDES } from "../generation/prompt.ts";
import { lirePromptSysteme } from "../generation/systeme.ts";
import { aujourdhui, trouverPassages } from "../recherche/passages.ts";

const PORT = Number(process.env.PORT ?? 3000);
if (nomDuModele() !== MODELE_DU_SEUIL) {
  console.warn(`Attention : le seuil d'abstention a été mesuré avec ${MODELE_DU_SEUIL}, pas avec ${nomDuModele()}. Relancez npm run seuils`);
}
const systeme = await lirePromptSysteme();
const serveur = creerServeur({
  chercher: (question, date) => trouverPassages(pool, question, PASSAGES_DEMANDES, date),
  generer: creerGenerateurEnFlux(),
  systeme,
  budget: BUDGET_PASSAGES,
  date: aujourdhui,
});
// 127.0.0.1 : le serveur ne répond qu'à cette machine, pas au reste du réseau
serveur.listen(PORT, "127.0.0.1", () => {
  console.log(`Rhéa écoute sur http://localhost:${PORT} (prompt v${systeme.version} ${systeme.empreinte})`);
});
