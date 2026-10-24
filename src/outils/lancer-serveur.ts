// Lancer le serveur de Rhéa : l'interface sur http://localhost:3000, et POST /ask pour les programmes
// Lancement : npm run serveur (Ctrl+C pour l'arrêter). npm run serveur construit d'abord l'interface (web/ → web/dist)
// Chapitre 14 : le serveur sert l'agent complet, celui de npm run agent et de l'évaluation, assemblé une seule fois
import { journalJsonl } from "../agent/journal.ts";
import { assemblerRhea, outilsDeRhea, PROMPT_AGENT } from "../agent/rhea.ts";
import { Confirmations } from "../api/confirmations.ts";
import { inspectionDe } from "../api/inspection.ts";
import { creerServeur } from "../api/serveur.ts";
import { chercherEnCache, creerCache, garder, viderLeCache } from "../cache/semantique.ts";
import { config } from "../config.ts";
import { pool } from "../db.ts";
import { nomDuModele, vectoriser } from "../embeddings/fournisseurs.ts";
import { lireTarifs } from "../eval/comparaison.ts";
import { plancherMesure } from "../generation/abstention.ts";
import { lirePromptSysteme } from "../generation/systeme.ts";
import { profilDuSalarie } from "../recherche/droits.ts";
import { aujourdhui } from "../recherche/passages.ts";
import { lireIndexation } from "../stockage/schema.ts";

const PORT = Number(process.env.PORT ?? 3000);
// Leçon 4 : l'agent applique le plancher d'abstention du modèle d'embedding configuré (abstention.ts, PLANCHERS)
if (!plancherMesure(nomDuModele())) {
  console.warn(`Attention : aucun plancher d'abstention mesuré pour ${nomDuModele()} : l'agent recevra les passages de toute question, même hors sujet (abstention.ts)`);
}
const systeme = await lirePromptSysteme(PROMPT_AGENT);
const version = `v${systeme.version} ${systeme.empreinte}`;
const tarifs = await lireTarifs();
const outils = outilsDeRhea(pool); // créés une fois ; chaque question assemble son agent, pour son salarié
const journaliser = journalJsonl(); // chaque appel d'outil au journal, pseudonymisé (chapitre 13)
// Leçon 6 : le cache sémantique, si .env le demande. Sa clé comprend la version de l'index : recalculée chaque minute, elle
// change dès qu'une réindexation (le travailleur) modifie un passage, et le cache ne sert plus les anciennes réponses
let versionDeLIndex = "";
async function lireVersionDeLIndex() {
  const { rows } = await pool.query<{ v: string }>("SELECT count(*) || ' ' || md5(coalesce(string_agg(empreinte || empreinte_meta, ',' ORDER BY id), '')) AS v FROM chunks");
  versionDeLIndex = rows[0].v;
}
if (config.CACHE_SEMANTIQUE) {
  const indexation = await lireIndexation(pool);
  if (!indexation) throw new Error("Cache sémantique : la base n'est pas indexée (npm run indexer)");
  await creerCache(pool, indexation.dimension);
  await viderLeCache(pool, aujourdhui());
  await lireVersionDeLIndex();
  // Chaque minute : la version de l'index, et les lignes des jours passés (leur clé ne sert plus, mais chaque recherche
  // dans le cache les parcourrait)
  setInterval(() => {
    lireVersionDeLIndex().catch(() => {});
    viderLeCache(pool, aujourdhui()).catch(() => {});
  }, 60_000).unref();
}
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
  cache: config.CACHE_SEMANTIQUE
    ? {
        seuil: config.CACHE_SEUIL,
        // tout ce qui change la réponse : le prompt, les LLM, le reclassement, la vérification, le modèle d'embedding, l'index
        version: () =>
          [
            version,
            `${config.LLM_PROVIDER} ${config.LLM_MODEL}`,
            `${config.LLM_RECHERCHE_PROVIDER ?? "-"} ${config.LLM_RECHERCHE_MODEL ?? "-"}`,
            config.RECLASSEMENT ? `${config.RERANK_PROVIDER} ${config.RERANK_MODEL}` : "sans reclassement",
            config.VERIFICATION ? "vérifiée" : "non vérifiée",
            nomDuModele(),
            versionDeLIndex,
          ].join(" | "),
        lire: async (question, cle) => {
          const [vecteur] = await vectoriser([question], "requete");
          return { vecteur, trouve: await chercherEnCache(pool, vecteur, cle, config.CACHE_SEUIL) };
        },
        ecrire: (vecteur, cle, reponse, sources) => garder(pool, vecteur, cle, reponse, sources),
      }
    : undefined,
});
// 127.0.0.1 : le serveur ne répond qu'à cette machine, pas au reste du réseau
serveur.listen(PORT, "127.0.0.1", () => {
  const mode = config.INSPECTION ? "mode inspection : chaque étape est visible dans l'interface" : "inspection désactivée";
  console.log(`Rhéa écoute sur http://localhost:${PORT} (prompt ${version}, ${config.LLM_PROVIDER} ${config.LLM_MODEL}, ${mode})`);
});
