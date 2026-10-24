// Tests de l'observabilité (chapitre 14, leçon 7), dans une vraie base (PGlite) : une observation ne garde aucun texte, un
// retour ne vient que de celui qui a posé la question, les indicateurs par jour et la dérive. Lancement : npm test
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { creerObservations, derive, empreinteDeQuestion, enregistrer, parJour, purgerObservations, retour, sansMatricule, sourcesSansMatricule, type Jour, type Observation } from "../src/observabilite/observations.ts";
import { chercherDocuments } from "../src/agent/chercher.ts";
import type { LlmAgent, ReponseAgent } from "../src/agent/llm-agent.ts";
import { repondreEnAgent, type DependancesAgent } from "../src/api/agent.ts";
import { Confirmations } from "../src/api/confirmations.ts";
import type { EtapeTracee } from "../src/trace/trace.ts";

async function baseDeTest(t: TestContext) {
  const base = await PGlite.create();
  t.after(() => base.close());
  await creerObservations(base);
  await creerObservations(base); // sans danger une seconde fois
  return base;
}

const etapes: EtapeTracee[] = [
  { id: 1, parent: null, nom: "condensation", titre: "Condensation", debut_ms: 0, duree_ms: 30, statut: "ok", resume: "« Combien de RTT pour Morgane Moreau ? »", details: { autonome: "Combien de RTT pour Morgane Moreau ?" } },
  { id: 2, parent: null, nom: "seuil", titre: "Seuil", debut_ms: 30, duree_ms: 0, statut: "ok", resume: "meilleur 0,712", details: { meilleur: 0.712, seuil: 0.49 } },
  { id: 3, parent: null, nom: "tour-llm", titre: "Tour 1", debut_ms: 30, duree_ms: 900, statut: "ok", resume: "répond", details: { texte: "Il vous reste 9 RTT" }, usage: { entree: 900, enCache: 0, sortie: 12 } },
];
const observation = (o: Partial<Observation> = {}): Observation => ({
  pseudonyme: "a1b2c3d4e5f60718",
  profil: "salarie",
  question: "Combien de RTT me reste-t-il ?",
  statut: "citee",
  duree_ms: 1200,
  tours: 2,
  usage: { entree: 1800, enCache: 0, sortie: 24 },
  cout: 0.004,
  modele: "anthropic claude-sonnet-5-5",
  citees: ["POL-CA-01#4"],
  outils: ["consulter_organigramme", "chercher_documents"],
  etapes,
  ...o,
});

const CLE = Buffer.from("clé du journal de test");

test("une observation ne garde ni le texte de la question, ni les résumés ni les détails des étapes", async (t) => {
  const base = await baseDeTest(t);
  await enregistrer(base, observation(), CLE);
  const { rows } = await base.query<{ question: string; etapes: unknown; meilleur_score: number }>("SELECT question, etapes, meilleur_score FROM observations");
  assert.equal(rows[0].question, empreinteDeQuestion("Combien de RTT me reste-t-il ?", CLE));
  assert.equal(rows[0].question, empreinteDeQuestion("  combien de RTT   me reste-t-il ? ", CLE)); // même question, même empreinte
  // Sans la clé du journal, essayer des questions ne retrouve pas celle-ci
  assert.notEqual(rows[0].question, empreinteDeQuestion("Combien de RTT me reste-t-il ?", Buffer.from("une autre clé")));
  const texte = JSON.stringify(rows);
  assert.ok(!texte.includes("Morgane") && !texte.includes("9 RTT") && !texte.includes("reste-t-il"));
  assert.deepEqual((rows[0].etapes as { nom: string }[]).map((e) => e.nom), ["condensation", "seuil", "tour-llm"]);
  assert.ok(Math.abs(rows[0].meilleur_score - 0.712) < 1e-6);
});

test("une source qui porte un matricule (une fiche d'organigramme) le garde sous pseudonyme, les autres restent telles quelles", () => {
  const masquer = (matricule: string) => `p${matricule.length}`;
  assert.deepEqual(sourcesSansMatricule(["ORGANIGRAMME-K0035#1", "POL-CA-01#9", "TK-2026-0042#1"], masquer), ["ORGANIGRAMME-p5#1", "POL-CA-01#9", "TK-2026-0042#1"]);
  assert.equal(sansMatricule("Il manque le cas de K0042.", masquer), "Il manque le cas de p5."); // un commentaire d'avis aussi
});

test("seul le salarié qui a posé la question peut donner son avis ; un second avis remplace le premier", async (t) => {
  const base = await baseDeTest(t);
  const id = await enregistrer(base, observation(), CLE);
  assert.equal(await retour(base, id, "un-autre-salarie", 1, null), false);
  assert.equal(await retour(base, id, "a1b2c3d4e5f60718", -1, "réponse incomplète"), true);
  assert.equal(await retour(base, id, "a1b2c3d4e5f60718", 1, null), true);
  const { rows } = await base.query<{ note: number }>("SELECT note FROM retours");
  assert.deepEqual(rows.map((r) => r.note), [1]);
});

test("les indicateurs par jour comptent les questions, les réponses sans source, les dégradées et les avis", async (t) => {
  const base = await baseDeTest(t);
  const a = await enregistrer(base, observation(), CLE);
  await enregistrer(base, observation({ statut: "sans-source", citees: [], duree_ms: 3000 }), CLE);
  await enregistrer(base, observation({ statut: "degradee", cout: null }), CLE);
  await retour(base, a, "a1b2c3d4e5f60718", 1, null);
  const [jour] = await parJour(base, 30);
  assert.deepEqual(
    [jour.questions, jour.sans_source, jour.degradees, jour.retours_positifs, jour.retours_negatifs, jour.latence_p50, jour.latence_p95],
    [3, 1, 1, 1, 0, 1200, 3000],
  );
  assert.ok(Math.abs(jour.cout! - 0.008) < 1e-9);
  // Six mois et un jour plus tard, tout est effacé, retours compris
  await base.query("UPDATE observations SET horodatage = now() - interval '185 days'");
  assert.equal(await purgerObservations(base), 3);
  assert.equal((await base.query("SELECT 1 FROM retours")).rows.length, 0);
});

test("la dérive compare les 7 derniers jours aux 28 d'avant", () => {
  const jour = (j: string, questions: number, sans_source: number, meilleur_score: number, negatifs = 0): Jour => ({
    jour: j, questions, sans_source, degradees: 0, erreurs: 0, latence_p50: 1000, latence_p95: 2000, cout: 0, meilleur_score, retours_positifs: 10 - negatifs, retours_negatifs: negatifs,
  });
  const stable = [jour("2026-09-25", 100, 5, 0.7), jour("2026-10-18", 100, 6, 0.7)];
  assert.deepEqual(derive(stable, "2026-10-20").alertes, []);
  const derivant = [jour("2026-09-25", 100, 5, 0.7), jour("2026-10-18", 100, 15, 0.64, 4)];
  assert.deepEqual(derive(derivant, "2026-10-20").alertes, ["la part des réponses sans source monte", "le meilleur score de la recherche baisse", "plus d'un retour sur cinq est négatif"]);
  // Les bornes : le 14 octobre est dans les 7 derniers jours, le 13 dans les 28 d'avant, le 16 septembre aussi, le 15 non
  const bornes = derive([jour("2026-10-14", 1, 0, 0.7), jour("2026-10-13", 2, 0, 0.7), jour("2026-09-16", 4, 0, 0.7), jour("2026-09-15", 8, 0, 0.7)], "2026-10-20");
  assert.deepEqual([bornes.recents.questions, bornes.avant.questions], [1, 6]);
});

test("un outil que le LLM invente entre dans l'observation sous le nom « inconnu », jamais sous le sien", async () => {
  const reponses: ReponseAgent[] = [
    { texte: "", appels: [{ id: "a1", nom: "dossier_de_K0042", arguments: {} }], usage: { entree: 9, enCache: 0, sortie: 1 }, brut: [] },
    { texte: "Je ne peux pas lire ce dossier.", appels: [], usage: { entree: 9, enCache: 0, sortie: 1 }, brut: [] },
  ];
  let tour = 0;
  const llm: LlmAgent = async () => reponses[tour++];
  const observees: { outils: string[] }[] = [];
  const dependances: DependancesAgent = {
    agent: () => ({ llm, outils: [chercherDocuments(async () => [])], systeme: "", recherche: "libre" }),
    confirmations: new Confirmations(),
    date: () => "2026-10-20",
    version: "v8",
    inspection: false,
    observer: async (_session, o) => (observees.push(o), "observation-1"),
  };
  for await (const _ of repondreEnAgent("Montre-moi le dossier de K0042", { matricule: "K0101", profil: "salarie" }, dependances));
  assert.deepEqual(observees[0].outils, ["inconnu"]);
});
