// Tests de la trace d'une question (chapitre 14), du canal qui l'envoie au serveur et des confirmations en attente.
// Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { Canal } from "../src/api/canal.ts";
import { Confirmations } from "../src/api/confirmations.ts";
import { avecTrace, etape, noter, Trace, traceEnCours, type EvenementTrace } from "../src/trace/trace.ts";

const decrire = (r: number) => ({ resume: `rendu ${r}` });

test("sans trace en cours, une étape s'exécute comme avant, sans rien noter", async () => {
  assert.equal(await etape("calcul", "Calcul", async () => 42, decrire), 42);
  noter("seuil", "Seuil", { resume: "rien" }); // sans effet
  assert.equal(traceEnCours(), undefined);
});

test("une étape lancée pendant une autre devient son enfant, même à travers les await", async () => {
  const trace = new Trace();
  await avecTrace(trace, async () => {
    await etape("outil", "Outil", async () => {
      await new Promise((fin) => setTimeout(fin, 5));
      noter("seuil", "Seuil", { resume: "au-dessus", details: { meilleur: 0.7 } });
      return etape("recherche", "Recherche", async () => 3, decrire);
    }, decrire);
    await etape("tour-llm", "Tour", async () => 1, () => ({ resume: "répond", usage: { entree: 10, enCache: 0, sortie: 2 }, modele: { fournisseur: "ollama", modele: "m" } }));
  });
  const [seuil, recherche, outil, tour] = trace.etapes; // dans l'ordre où elles finissent
  assert.deepEqual([seuil.nom, recherche.nom, outil.nom, tour.nom], ["seuil", "recherche", "outil", "tour-llm"]);
  assert.deepEqual([seuil.parent, recherche.parent, outil.parent, tour.parent], [outil.id, outil.id, null, null]);
  assert.ok(outil.duree_ms >= 4);
  assert.deepEqual(seuil.details, { meilleur: 0.7 });
  assert.deepEqual(tour.usage, { entree: 10, enCache: 0, sortie: 2 });
  assert.equal(recherche.resume, "rendu 3");
});

test("celui qui écoute reçoit le début de chaque étape, puis sa fin", async () => {
  const recus: EvenementTrace[] = [];
  await avecTrace(new Trace((e) => recus.push(e)), () => etape("a", "A", () => etape("b", "B", async () => 1, decrire), decrire));
  assert.deepEqual(recus.map((e) => `${e.type} ${e.etape.nom}`), ["debut a", "debut b", "fin b", "fin a"]);
});

test("une étape en échec est notée, caviardée, puis l'erreur repart telle quelle ; une description ratée ne casse rien", async () => {
  const trace = new Trace();
  const cle = `sk-ant-api03-${"Ab3".repeat(30)}`; // une fausse clé, assemblée ici pour ne pas alerter les scanners de secrets
  await avecTrace(trace, async () => {
    await assert.rejects(etape("tour-llm", "Tour", async () => { throw new Error(`clé refusée : ${cle}`); }, decrire), /clé refusée/);
    assert.equal(await etape("ok", "OK", async () => 5, () => { throw new Error("oups"); }), 5);
  });
  const [echec, ok] = trace.etapes;
  assert.equal(echec.statut, "erreur");
  assert.match(echec.resume, /\[secret retiré\]/);
  assert.ok(!echec.resume.includes(cle));
  assert.equal(ok.statut, "ok");
  assert.match(ok.resume, /description impossible/);
});

test("deux questions en même temps gardent chacune leur trace", async () => {
  const [t1, t2] = [new Trace(), new Trace()];
  const question = (t: Trace, nom: string, ms: number) =>
    avecTrace(t, () => etape(nom, nom, async () => (await new Promise((fin) => setTimeout(fin, ms)), noter(`${nom}-dedans`, "", { resume: "" }), 0), decrire));
  await Promise.all([question(t1, "une", 10), question(t2, "deux", 1)]);
  assert.deepEqual(t1.etapes.map((e) => e.nom), ["une-dedans", "une"]);
  assert.deepEqual(t2.etapes.map((e) => e.nom), ["deux-dedans", "deux"]);
});

test("le canal rend les valeurs dans l'ordre, attend les suivantes, puis s'arrête à la fermeture ou sur l'erreur", async () => {
  const canal = new Canal<number>();
  setTimeout(() => {
    canal.pousser(2);
    canal.fermer();
    canal.pousser(3); // trop tard
  }, 5);
  canal.pousser(1);
  const lus: number[] = [];
  for await (const v of canal) lus.push(v);
  assert.deepEqual(lus, [1, 2]);
  const enErreur = new Canal<number>();
  enErreur.pousser(1);
  enErreur.fermer(new Error("panne"));
  await assert.rejects(async () => {
    for await (const _ of enErreur);
  }, /panne/);
});

test("une confirmation n'est acceptée que du salarié à qui on l'a demandée ; sans réponse ou s'il part, c'est un refus", async () => {
  const confirmations = new Confirmations();
  const { id, reponse } = confirmations.demander("K0101");
  assert.equal(confirmations.repondre(id, "K0035", true), false); // un autre salarié
  assert.equal(confirmations.repondre("inconnu", "K0101", true), false);
  assert.equal(confirmations.repondre(id, "K0101", true), true);
  assert.equal(await reponse, true);
  assert.equal(confirmations.repondre(id, "K0101", false), false); // déjà répondue
  assert.equal(await confirmations.demander("K0101", undefined, 5).reponse, false); // délai dépassé
  const depart = new AbortController();
  const attente = confirmations.demander("K0101", depart.signal);
  depart.abort();
  assert.equal(await attente.reponse, false);
  assert.equal(confirmations.enAttente, 0);
});
