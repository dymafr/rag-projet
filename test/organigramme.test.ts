// Tests de l'organigramme en graphe (chapitre 12, leçon 2) : les requêtes récursives et l'outil de Rhéa, sur une vraie
// base PostgreSQL, PGlite, chargée avec les salariés fictifs de corpus/soldes/soldes.sql. Pas de Docker, pas de LLM.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { executer } from "../src/agent/boucle.ts";
import { consulterOrganigramme } from "../src/agent/organigramme.ts";
import { chaine, equipe, trouver, verifier } from "../src/graphe/organigramme.ts";

let base: PGlite;
before(async () => {
  base = await PGlite.create();
  await base.exec(await readFile("corpus/soldes/soldes.sql", "utf8"));
});
after(() => base.close());

test("chaine remonte du salarié jusqu'à la direction, un niveau par manager", async () => {
  const liste = await chaine(base, "K0042");
  assert.deepEqual(liste.map((p) => [p.matricule, p.niveau]), [["K0042", 0], ["K0035", 1], ["K0001", 2]]);
  assert.deepEqual((await chaine(base, "K0001")).map((p) => p.matricule), ["K0001"]); // la direction n'a pas de manager
  assert.deepEqual(await chaine(base, "K9999"), []);
});

test("equipe rend l'équipe directe et compte toutes les personnes dessous", async () => {
  const { directs, total } = await equipe(base, "K0035");
  assert.equal(directs.length, 9);
  assert.equal(total, 9); // ses équipiers n'ont pas d'équipe
  const direction = await equipe(base, "K0001");
  assert.equal(direction.directs.length, 14);
  assert.ok(direction.total > direction.directs.length); // les équipes de ses managers comptent aussi
  assert.equal((await equipe(base, "K0042")).directs.length, 0);
});

test("trouver accepte un matricule, un nom sans accent, et rend toutes les personnes d'un même nom", async () => {
  assert.deepEqual((await trouver(base, "k0042")).map((p) => p.matricule), ["K0042"]);
  assert.deepEqual((await trouver(base, "eva guerin")).map((p) => p.matricule), ["K0035"]);
  assert.deepEqual((await trouver(base, "Guérin Eva")).map((p) => p.matricule), ["K0035"]);
  const lucas = await trouver(base, "Lucas");
  assert.ok(lucas.length >= 2); // Adèle Lucas et Alice Lucas, au moins
  assert.ok((await trouver(base, "Eva")).every((p) => p.nom !== "Chevalier")); // au début d'un mot seulement
  assert.deepEqual(await trouver(base, "Personne Inconnue"), []);
});

test("verifier trouve la direction, et une boucle quand une erreur de saisie en crée une", async () => {
  const sain = await verifier(base);
  assert.deepEqual(sain.racines.map((p) => p.matricule), ["K0001", "K0002", "K0003", "K0004"]);
  assert.equal(sain.managersInconnus.length, 0);
  assert.equal(sain.boucles.length, 0);
  // Eva Guérin devient, par erreur, la subordonnée d'Adèle Lucas, qui est dans son équipe
  await base.query("UPDATE salaries SET manager = 'K0042' WHERE matricule = 'K0035'");
  try {
    const casse = await verifier(base);
    assert.equal(casse.boucles.length, 1);
    assert.deepEqual([...casse.boucles[0]].sort(), ["K0035", "K0042"]);
    // La requête récursive s'arrête au lieu de tourner sans fin
    assert.deepEqual((await chaine(base, "K0042")).map((p) => p.matricule), ["K0042", "K0035"]);
    // Et chaque personne n'est comptée qu'une fois : ses 9 équipiers, plus elle-même, revenue par la boucle
    assert.equal((await equipe(base, "K0035")).total, 10);
  } finally {
    await base.query("UPDATE salaries SET manager = 'K0001' WHERE matricule = 'K0035'");
  }
});

test("consulter_organigramme donne le manager du salarié connecté, ou la place d'une personne nommée", async () => {
  const outil = consulterOrganigramme(base);
  const moi = await outil.executer({ personne: null }, { date: "2026-10-17", matricule: "K0042", profil: "salarie" as const });
  assert.match(moi.texte, /Le salarié connecté : Adèle Lucas \(K0042\)/);
  assert.match(moi.texte, /Manager : Eva Guérin \(K0035\), Responsable projets clients/);
  assert.match(moi.texte, /Au-dessus : Noémie Millet \(K0001\)/);
  // La fiche est un passage à citer, comme ceux de la documentation
  assert.match(moi.texte, /^<passage source="ORGANIGRAMME-K0042#1" titre="Organigramme de Kalyo > Adèle Lucas">/);
  assert.deepEqual(moi.passages?.map((p) => p.id), ["ORGANIGRAMME-K0042#1"]);
  const eva = await outil.executer({ personne: "Eva Guerin" }, { date: "2026-10-17", profil: "salarie" as const });
  assert.match(eva.texte, /Équipe directe \(9 personnes\)/);
  const direction = await outil.executer({ personne: "Noémie Millet" }, { date: "2026-10-17", profil: "salarie" as const });
  assert.match(direction.texte, /fait partie de la direction/);
  assert.match(direction.texte, /Équipe directe \(14 personnes\)/);
  assert.doesNotMatch(direction.texte, /autres/); // la liste ne s'abrège qu'au-delà de 20 personnes
  assert.match(direction.texte, /En tout, \d+ personnes dépendent de cette personne/);
});

test("un champ facultatif omis par le LLM vaut null : l'appel sans argument vise le salarié connecté", async () => {
  // Constaté avec le modèle local : il envoie {} au lieu de {"personne": null}
  const appel = { id: "a", nom: "consulter_organigramme", arguments: {} };
  const { resultat, erreur } = await executer(appel, [consulterOrganigramme(base)], { date: "2026-10-17", matricule: "K0042", profil: "salarie" as const });
  assert.equal(erreur, false);
  assert.match(resultat.texte, /Le salarié connecté : Adèle Lucas/);
});

test("consulter_organigramme demande de préciser un nom ambigu, et ne devine pas un nom inconnu", async () => {
  const outil = consulterOrganigramme(base);
  assert.match((await outil.executer({ personne: "Lucas" }, { date: "2026-10-17", profil: "salarie" as const })).texte, /Plusieurs personnes correspondent/);
  const inconnu = await outil.executer({ personne: "référente handicap" }, { date: "2026-10-17", profil: "salarie" as const });
  assert.match(inconnu.texte, /Personne ne s'appelle « référente handicap »/);
  assert.match(inconnu.texte, /cherchez d'abord son nom dans la documentation/); // un rôle n'est pas un nom
  assert.match((await outil.executer({ personne: null }, { date: "2026-10-17", profil: "salarie" as const })).texte, /Aucun salarié n'est connecté/);
});
