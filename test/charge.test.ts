// Tests de la tenue de charge (chapitre 14, leçon 8) : le disjoncteur, le repli de fournisseur, le limiteur et la réponse
// dégradée quand aucun LLM ne répond. Faux fournisseurs et fausse horloge : ni clé, ni réseau. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import type { LlmAgent, Message, ReponseAgent } from "../src/agent/llm-agent.ts";
import { chercherDocuments } from "../src/agent/chercher.ts";
import { DEGRADE_AVEC_PASSAGES, DEGRADE_SANS_PASSAGE, repondreEnAgent, type EvenementAgent } from "../src/api/agent.ts";
import { Confirmations } from "../src/api/confirmations.ts";
import { Disjoncteur, DisjoncteurOuvert, duFournisseur } from "../src/charge/disjoncteur.ts";
import { Abandonnee, Limiteur, Sature } from "../src/charge/limiteur.ts";
import { agentAvecRepli, llmAvecRepli, repliPour } from "../src/charge/repli.ts";
import type { Resultat } from "../src/recherche/vectorielle.ts";
import { avecTrace, Trace } from "../src/trace/trace.ts";

// Sans statut : le réseau, comme le lèvent les SDK (une APIConnectionError)
const panne = (status?: number) =>
  status === undefined ? Object.assign(new Error("Connection error."), { name: "APIConnectionError" }) : Object.assign(new Error(`HTTP ${status}`), { status });
const usage = { entree: 10, enCache: 0, sortie: 2 };
const reponse = (texte: string, brut: unknown[] = []): ReponseAgent => ({ texte, appels: [], usage, brut });

test("une erreur du fournisseur (429, 5xx, réseau) n'est ni une erreur de notre demande (400), ni un bogue", () => {
  assert.deepEqual([panne(429), panne(529), panne(503), panne(), panne(408)].map(duFournisseur), [true, true, true, true, true]);
  assert.deepEqual([panne(400), panne(401), panne(404)].map(duFournisseur), [false, false, false]);
  // Un paiement refusé (402), un plafond de dépense fixé chez Anthropic (400) : le repli peut répondre
  const plafond = Object.assign(new Error("You have reached your specified API usage limits"), { status: 400 });
  assert.deepEqual([panne(402), plafond].map(duFournisseur), [true, true]);
  const coupure = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
  assert.equal(duFournisseur(coupure), true);
  assert.equal(duFournisseur(new TypeError("Cannot read properties of undefined (reading 'texte')")), false);
});

test("le disjoncteur s'ouvre après trois échecs de suite, refuse sans appeler, puis laisse passer un seul essai", async () => {
  let maintenant = 0;
  const d = new Disjoncteur("anthropic test", { seuil: 3, pause: 60_000, maintenant: () => maintenant });
  let appels = 0;
  const enPanne = () => (appels++, Promise.reject(panne(529)));
  for (let i = 0; i < 3; i++) await assert.rejects(d.appeler(enPanne), /529/);
  assert.equal(d.etat, "ouvert");
  await assert.rejects(d.appeler(enPanne), DisjoncteurOuvert);
  assert.equal(appels, 3); // ouvert : le fournisseur n'est plus appelé
  maintenant = 61_000;
  assert.equal(d.etat, "demi-ouvert");
  let liberer = () => {};
  const essai = d.appeler(() => new Promise((ok) => (liberer = () => ok("répondu"))));
  await assert.rejects(d.appeler(async () => "second"), DisjoncteurOuvert); // un seul essai à la fois
  liberer();
  assert.equal(await essai, "répondu");
  assert.equal(d.etat, "ferme");
  // Une erreur de notre demande ne compte pas : elle échouerait partout
  for (let i = 0; i < 5; i++) await assert.rejects(d.appeler(() => Promise.reject(panne(400))));
  assert.equal(d.etat, "ferme");
});

test("le repli prend le relais quand le principal tombe, garde la question chez lui, et retire le brut de l'autre API", async () => {
  const recus: Message[][] = [];
  let principalEnPanne = false;
  const principal: LlmAgent = async () => {
    if (principalEnPanne) throw panne(529);
    return reponse("du principal", [{ type: "thinking", signature: "chez-anthropic" }]);
  };
  const repli: LlmAgent = async (_s, messages) => (recus.push(messages), reponse("du repli"));
  const modele = (m: string) => ({ fournisseur: "test", modele: m });
  const { llm, modele: courant } = agentAvecRepli(
    { appel: principal, modele: modele("principal"), disjoncteur: new Disjoncteur("p") },
    { appel: repli, modele: modele("repli"), disjoncteur: new Disjoncteur("r") },
  );
  const conversation: Message[] = [{ role: "utilisateur", texte: "?" }, { role: "assistant", texte: "…", appels: [], brut: [{ type: "thinking" }] }];
  const trace = new Trace();
  await avecTrace(trace, async () => {
    assert.equal((await llm("s", conversation, [])).texte, "du principal");
    assert.equal(courant().modele, "principal");
    principalEnPanne = true;
    assert.equal((await llm("s", conversation, [])).texte, "du repli");
    principalEnPanne = false; // revenu, mais la question reste chez le repli : sa conversation n'a plus le brut du principal
    assert.equal((await llm("s", conversation, [])).texte, "du repli");
  });
  assert.equal(courant().modele, "repli");
  assert.ok(recus.every((m) => m.every((x) => x.role !== "assistant" || x.brut === undefined)));
  assert.deepEqual(trace.etapes.map((e) => e.nom), ["repli"]);
  // Sans repli, l'erreur repart telle quelle ; une erreur de notre demande ne déclenche pas le repli
  const seul = agentAvecRepli({ appel: async () => { throw panne(500); }, modele: modele("p"), disjoncteur: new Disjoncteur("p2") });
  await assert.rejects(seul.llm("s", [], []), /500/);
  const mauvaise = agentAvecRepli({ appel: async () => { throw panne(400); }, modele: modele("p"), disjoncteur: new Disjoncteur("p3") }, { appel: repli, modele: modele("r"), disjoncteur: new Disjoncteur("r3") });
  await assert.rejects(mauvaise.llm("s", [], []), /400/);
  const simple = llmAvecRepli({ appel: async () => { throw panne(); }, modele: modele("p"), disjoncteur: new Disjoncteur("p4") }, { appel: async () => ({ texte: "ok", usage }), modele: modele("r"), disjoncteur: new Disjoncteur("r4") });
  assert.equal((await simple("a", "b")).texte, "ok");
});

test("le limiteur garde au plus n questions en cours, met les suivantes en attente, et refuse au-delà de la file", async () => {
  const limiteur = new Limiteur(2, 1);
  const liberations: (() => void)[] = [];
  const longue = () => new Promise<void>((fin) => liberations.push(fin));
  const a = limiteur.avecPlace(longue);
  const b = limiteur.avecPlace(longue);
  const c = limiteur.avecPlace(longue); // en attente
  await assert.rejects(limiteur.avecPlace(longue), Sature); // la file est pleine
  assert.deepEqual(limiteur.etat, { enCours: 2, enAttente: 1, max: 2, attenteMax: 1 });
  liberations.shift()!(); // a finit : c prend sa place
  await a;
  await new Promise((suite) => setImmediate(suite));
  assert.deepEqual([limiteur.etat.enCours, limiteur.etat.enAttente], [2, 0]);
  liberations.forEach((f) => f());
  await new Promise((suite) => setImmediate(suite));
  liberations.forEach((f) => f());
  await Promise.all([b, c]);
  assert.equal(limiteur.etat.enCours, 0);
});

test("le repli d'un LLM est chez un autre fournisseur : celui de .env, sinon le LLM qui rédige", () => {
  const redige = { fournisseur: "anthropic", modele: "grand" };
  const recherche = { fournisseur: "openai", modele: "petit" };
  const repli = { fournisseur: "openai", modele: "moyen" };
  assert.deepEqual(repliPour(redige, repli, redige), repli); // l'agent : le repli de .env, chez OpenAI
  assert.deepEqual(repliPour(recherche, repli, redige), redige); // les étapes de la recherche : pas OpenAI, mais Anthropic
  assert.equal(repliPour(redige, undefined, redige), undefined); // aucun repli à chercher dans .env, ni ailleurs
});

test("une question abandonnée pendant son attente quitte la file sans prendre de place", async () => {
  const limiteur = new Limiteur(1, 2);
  let finir = () => {};
  const premiere = limiteur.avecPlace(() => new Promise<void>((fin) => (finir = fin)));
  const depart = new AbortController();
  const abandonnee = limiteur.avecPlace(async () => "jamais servie", depart.signal);
  const suivante = limiteur.avecPlace(async () => "servie");
  assert.equal(limiteur.etat.enAttente, 2);
  depart.abort(); // le salarié ferme l'onglet
  await assert.rejects(abandonnee, Abandonnee);
  assert.equal(limiteur.etat.enAttente, 1);
  finir();
  await premiere;
  assert.equal(await suivante, "servie");
  assert.deepEqual([limiteur.etat.enCours, limiteur.etat.enAttente], [0, 0]);
  await assert.rejects(limiteur.avecPlace(async () => 1, depart.signal), Abandonnee); // déjà parti : aucune place prise
  assert.equal(limiteur.etat.enCours, 0);
});

test("sans aucun LLM, Rhéa rend les passages les plus proches, ou dit de réessayer quand rien n'est proche", async () => {
  const proche: Resultat = { id: "POL-TT-02#4", document: "POL-TT-02", titres: ["Avenant"], texte: "Trois jours par semaine.", score: 0.8 };
  const loin: Resultat = { ...proche, score: 0.2 };
  const essai = async (passages: Resultat[]) => {
    const liste: EvenementAgent[] = [];
    const flux = repondreEnAgent("Combien de jours de télétravail ?", { matricule: "K0101", profil: "salarie" }, {
      agent: () => ({ llm: async () => { throw new DisjoncteurOuvert("anthropic test"); }, outils: [chercherDocuments(async () => [proche])], systeme: "", recherche: "libre" }),
      confirmations: new Confirmations(),
      date: () => "2026-10-20",
      version: "v7",
      inspection: true,
      passagesSeuls: async () => passages,
    });
    for await (const e of flux) liste.push(e);
    return liste;
  };
  const avec = await essai([proche, proche, proche, proche]);
  assert.deepEqual((avec.find((e) => e.nom === "texte")!.donnees as { texte: string }).texte, DEGRADE_AVEC_PASSAGES);
  assert.equal((avec.find((e) => e.nom === "sources")!.donnees as { citees: unknown[] }).citees.length, 3);
  assert.equal((avec.find((e) => e.nom === "fin")!.donnees as { degrade?: boolean }).degrade, true);
  assert.ok(avec.some((e) => e.nom === "etape" && e.donnees.type === "fin" && e.donnees.etape.nom === "degradation"));
  const sans = await essai([loin]);
  assert.equal((sans.find((e) => e.nom === "texte")!.donnees as { texte: string }).texte, DEGRADE_SANS_PASSAGE);
});
