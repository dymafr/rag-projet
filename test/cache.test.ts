// Tests du cache sémantique (chapitre 14, leçon 6) : la clé (profil, jour, version) et le seuil dans une vraie base
// (PGlite avec pgvector), les réponses personnelles jamais gardées, et le parcours complet dans la réponse de Rhéa : une
// question reprise ne rappelle pas le LLM. Lancement : npm test
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { chercherDocuments } from "../src/agent/chercher.ts";
import type { LlmAgent, ReponseAgent } from "../src/agent/llm-agent.ts";
import { repondreEnAgent, type DependancesAgent, type EvenementAgent, type SourceCitee } from "../src/api/agent.ts";
import { Confirmations } from "../src/api/confirmations.ts";
import { chercherEnCache, creerCache, garder, personnelle, viderLeCache, type Cle, type EnCache } from "../src/cache/semantique.ts";
import type { Resultat } from "../src/recherche/vectorielle.ts";

async function baseDeTest(t: TestContext) {
  const base = await PGlite.create({ extensions: { vector } });
  t.after(() => base.close());
  await base.exec("CREATE EXTENSION IF NOT EXISTS vector");
  await creerCache(base, 3);
  return base;
}
const unitaire = (v: number[]) => v.map((x) => x / Math.hypot(...v));
const source: SourceCitee = { id: "POL-TT-02#4", document: "POL-TT-02", titre: "Avenant", score: 0.8, texte: "Trois jours." };

test("le cache ne rend une réponse qu'avec la même clé (profil, jour, version) et au-dessus du seuil", async (t) => {
  const base = await baseDeTest(t);
  const cle: Cle = { profil: "salarie", jour: "2026-10-20", version: "v7 index-1" };
  await garder(base, unitaire([1, 0, 0]), cle, "Trois jours par semaine.", [source]);
  const trouve = await chercherEnCache(base, unitaire([0.99, 0.1, 0]), cle, 0.92);
  assert.equal(trouve?.reponse, "Trois jours par semaine.");
  assert.deepEqual(trouve?.sources, [source]);
  assert.ok(trouve!.similarite > 0.99);
  assert.equal(await chercherEnCache(base, unitaire([0.6, 0.8, 0]), cle, 0.92), null); // trop loin
  for (const autre of [{ ...cle, profil: "manager" }, { ...cle, jour: "2026-10-21" }, { ...cle, version: "v7 index-2" }]) {
    assert.equal(await chercherEnCache(base, unitaire([1, 0, 0]), autre, 0.92), null); // une seule chose change : rien
  }
  assert.equal(await viderLeCache(base, "2026-10-21"), 1); // le lendemain, la ligne part
});

test("un autre modèle d'embedding, une autre dimension : la table du cache est recréée, la même dimension la garde", async (t) => {
  const base = await baseDeTest(t);
  const cle: Cle = { profil: "salarie", jour: "2026-10-20", version: "v7 index-1" };
  await garder(base, unitaire([1, 0, 0]), cle, "Trois jours par semaine.", [source]);
  await creerCache(base, 3); // même dimension : la réponse reste
  assert.equal((await chercherEnCache(base, unitaire([1, 0, 0]), cle, 0.92))?.reponse, "Trois jours par semaine.");
  await creerCache(base, 4); // bascule vers un modèle de dimension 4 : table neuve, vide
  assert.equal(await chercherEnCache(base, unitaire([1, 0, 0, 0]), cle, 0.92), null);
});

test("une réponse personnelle ne va pas dans le cache : outil personnel, fiche citée ou reprise, question de suite", () => {
  const recherche = { id: "a1", nom: "chercher_documents" };
  const fiche = { id: "organigramme-d-office", nom: "consulter_organigramme" };
  const base = { historique: 0, appels: [fiche, recherche], ficheDOffice: "Morgane Moreau, Développeuse. Manager : Sylvain Rousseau.", texte: "Trois jours par semaine [POL-TT-02#4]." };
  assert.equal(personnelle(base), false); // la fiche lue d'office, mais pas reprise dans la réponse
  assert.equal(personnelle({ ...base, texte: "Demandez à Sylvain Rousseau [POL-TT-02#4]." }), true);
  assert.equal(personnelle({ ...base, appels: [fiche, { id: "a2", nom: "consulter_solde" }] }), true);
  assert.equal(personnelle({ ...base, appels: [{ id: "a3", nom: "consulter_organigramme" }] }), true); // demandé par le LLM
  assert.equal(personnelle({ ...base, historique: 1 }), true);
  // La fiche telle que l'écrit l'organigramme : son site, repris sans aucun nom, rend la réponse personnelle ; la citer aussi
  const lyon = "Le salarié connecté : Morgane Moreau (K0101), Développeuse, service Développement, site de Lyon.\n- Manager : Sylvain Rousseau (K0012).";
  assert.equal(personnelle({ ...base, ficheDOffice: lyon, texte: "L'accueil de votre site de Lyon ouvre de 8 h 30 à 17 h 30 [INT-SITE-LYON#5]." }), true);
  assert.equal(personnelle({ ...base, ficheDOffice: lyon, texte: "Votre manager valide la demande [ORGANIGRAMME-K0101#1]." }), true);
  assert.equal(personnelle({ ...base, ficheDOffice: lyon }), false); // rien de la fiche dans la réponse
});

test("une question reprise par le cache ne rappelle pas le LLM ; une question de suite ou datée n'y passe pas", async () => {
  const passage: Resultat = { id: "POL-TT-02#4", document: "POL-TT-02", titres: ["Avenant"], texte: "Trois jours.", score: 0.8 };
  let appelsAuLlm = 0;
  const reponses: ReponseAgent[] = [
    { texte: "", appels: [{ id: "a1", nom: "chercher_documents", arguments: { requete: "télétravail" } }], usage: { entree: 9, enCache: 0, sortie: 1 }, brut: [] },
    { texte: "Trois jours par semaine [POL-TT-02#4].", appels: [], usage: { entree: 9, enCache: 0, sortie: 1 }, brut: [] },
  ];
  const llm: LlmAgent = async () => reponses[appelsAuLlm++ % 2];
  const enMemoire: { vecteur: number[]; cle: Cle; reponse: string; sources: SourceCitee[] }[] = [];
  const dependances: DependancesAgent = {
    agent: () => ({ llm, outils: [chercherDocuments(async () => [passage])], systeme: "", recherche: "libre" }),
    confirmations: new Confirmations(),
    date: () => "2026-10-20",
    version: "v7",
    inspection: true,
    cache: {
      seuil: 0.92,
      version: () => "v7 index-1",
      lire: async (question, cle) => {
        const trouve = enMemoire.find((e) => e.cle.profil === cle.profil && e.vecteur[0] === question.length);
        return { vecteur: [question.length], trouve: trouve ? ({ reponse: trouve.reponse, sources: trouve.sources, similarite: 1 } satisfies EnCache) : null };
      },
      ecrire: async (vecteur, cle, reponse, sources) => void enMemoire.push({ vecteur, cle, reponse, sources }),
    },
  };
  const poser = async (question: string, historique: { question: string; reponse: string }[] = []) => {
    const liste: EvenementAgent[] = [];
    for await (const e of repondreEnAgent(question, { matricule: "K0101", profil: "salarie" }, dependances, undefined, historique)) liste.push(e);
    return liste;
  };
  const premiere = await poser("Combien de jours de télétravail ?");
  assert.equal(appelsAuLlm, 2);
  assert.equal(enMemoire.length, 1); // générique et citée : gardée
  const seconde = await poser("Combien de jours de télétravail ?");
  assert.equal(appelsAuLlm, 2); // aucun nouvel appel
  const fin = seconde.find((e) => e.nom === "fin")!.donnees as { cache?: number; cout: { max: number } };
  assert.deepEqual([fin.cache, fin.cout.max], [1, 0]);
  assert.deepEqual(seconde.find((e) => e.nom === "texte")!.donnees, premiere.find((e) => e.nom === "texte")!.donnees);
  // Une question de suite ne passe pas par le cache, et ne s'y écrit pas
  await poser("Combien de jours de télétravail ?", [{ question: "Et à Nantes ?", reponse: "…" }]);
  assert.equal(appelsAuLlm, 4);
  assert.equal(enMemoire.length, 1);
  // Une question datée non plus : la règle a pu changer depuis (leçon 6, aDesIndices)
  await poser("En 2025, combien de jours de télétravail ?");
  assert.equal(appelsAuLlm, 6);
  assert.equal(enMemoire.length, 1);
});
