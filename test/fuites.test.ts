// Tests des fuites par le contexte et par le journal (chapitre 13, leçon 4) : les secrets caviardés à l'ingestion, rien
// de secret dans les prompts (le « contexte caché »), et un journal qui ne garde que des références, sous pseudonyme,
// six mois. Les fausses clés sont assemblées à l'exécution : écrites en entier dans un fichier, elles feraient réagir
// les scanners de secrets (ceux de GitHub, par exemple). Lancement : npm test
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agir, type EntreeJournal } from "../src/agent/boucle.ts";
import { chercherDocuments } from "../src/agent/chercher.ts";
import { cleDuJournal, journalJsonl, pseudonyme, purgerJournal } from "../src/agent/journal.ts";
import type { LlmAgent } from "../src/agent/llm-agent.ts";
import { ingerer } from "../src/ingestion/pipeline.ts";
import { caviarder } from "../src/ingestion/secrets.ts";
import type { Resultat } from "../src/recherche/vectorielle.ts";

const x = (n: number) => "Ab3".repeat(n).slice(0, n); // des caractères qui ressemblent à une clé, sans en être une
const FAUSSES = {
  "clé Anthropic": `sk-ant-api03-${x(40)}`,
  "clé OpenAI": `sk-proj-${x(48)}`,
  "clé AWS": `AKIA${"ABCD1234EFGH5678"}`,
  "jeton GitHub": `ghp_${x(36)}`,
  "jeton Slack": `xoxb-${x(24)}`,
  "jeton JWT": `eyJ${x(20)}.eyJ${x(20)}.${x(20)}`,
  "chaîne de connexion": `postgres://rhea:${x(12)}@base.kalyo.fr:5432/rhea`,
  "mot de passe": `mot de passe : ${x(10)}`,
};
// D'autres formes des mêmes règles : des jetons GitHub à grain fin et d'installation (forme de 2026), une clé AWS
// temporaire, un jeton d'application Slack, un mot de passe nommé
const AUTRES: [regle: string, secret: string][] = [
  ["jeton GitHub", `github_pat_${x(22)}_${x(59)}`],
  ["jeton GitHub", `ghs_1234567_eyJ${x(30)}.eyJ${x(60)}.${x(43)}`],
  ["jeton Slack", `xapp-1-A0${x(10)}-${x(40)}`],
  ["clé AWS", `ASIA${"ABCD1234EFGH5678"}`],
  ["mot de passe", `Mot de passe du wifi invités : ${x(12)}`],
];

test("caviarder reconnaît chaque forme de secret et ne laisse que [secret retiré]", () => {
  for (const [regle, secret] of [...Object.entries(FAUSSES), ...AUTRES]) {
    const { texte, regles } = caviarder(`Bonjour, voici ${secret} pour l'outil.`);
    assert.deepEqual(regles, [regle], regle);
    assert.equal(texte, "Bonjour, voici [secret retiré] pour l'outil.", regle);
  }
  const cle = ["-----BEGIN ", "PRIVATE KEY-----\n", x(64), "\n-----END ", "PRIVATE KEY-----"].join("");
  assert.deepEqual(caviarder(`La clé : ${cle} fin.`), { texte: "La clé : [secret retiré] fin.", regles: ["clé privée"] });
});

test("caviarder laisse passer les phrases de l'intranet qui parlent de mots de passe, les adresses web et les codes", () => {
  for (const texte of [
    "Utilisez un mot de passe différent pour chaque service, et n'utilisez jamais votre mot de passe Kalyo ailleurs.",
    "Ne communiquez votre mot de passe à personne. Le support ne vous le demandera jamais.",
    "J'ai oublié mon mot de passe : impossible de me connecter depuis lundi.", // un ticket, pas un secret
    "Tout est sur https://intranet.kalyo.fr/rh ou sur mailto:rh@kalyo.fr.",
    "Le code EMA, l'article 12.3, une gestion risk-free.",
  ]) {
    assert.deepEqual(caviarder(texte).regles, [], texte);
  }
});

test("le corpus ne contient aucun secret ; le ticket piégé reste le seul en quarantaine", async (t) => {
  const dossier = await mkdtemp(join(tmpdir(), "rhea-corpus-"));
  t.after(() => rm(dossier, { recursive: true, force: true }));
  const bilan = await ingerer({ sortie: join(dossier, "documents.jsonl"), journal: join(dossier, "ingestion.log"), effacements: join(dossier, "aucun.json") });
  assert.deepEqual([bilan.secrets, bilan.quarantaine.map((q) => q.id), bilan.erreurs], [[], ["TK-2026-0060"], []]);
});

test("rien de secret dans les prompts : le prompt système se suppose découvrable (le « contexte caché »)", async () => {
  for (const nom of await readdir("prompts")) {
    assert.deepEqual(caviarder(await readFile(join("prompts", nom), "utf8")).regles, [], nom);
  }
});

async function corpusAvecUneCle(t: TestContext) {
  const racine = await mkdtemp(join(tmpdir(), "rhea-secrets-"));
  t.after(() => rm(racine, { recursive: true, force: true }));
  for (const dossier of ["politiques", "accords", "managers", "groupe", "intranet", "faq", "tickets"]) await mkdir(join(racine, dossier));
  await writeFile(join(racine, "tickets", "tickets.json"), JSON.stringify([{
    id: "TK-2026-9201", date: "2026-06-01", site: "lyon", demandeur: { matricule: "K0199", prenom: "Test", nom: "Exemple" }, categorie: "Outils",
    sujet: `Accès à l'outil de notes de frais (jeton ${FAUSSES["jeton GitHub"]})`, message: `L'outil refuse ma connexion, voici ma clé ${FAUSSES["clé OpenAI"]}, qu'est-ce qui ne va pas ?`,
    reponse: "Ne communiquez jamais une clé : nous la révoquons et vous en envoyons une nouvelle.", traite_par: "K0006", statut: "clos",
  }]));
  return { racine, sortie: join(racine, "sortie", "documents.jsonl"), journal: join(racine, "sortie", "ingestion.log"), effacements: join(racine, "aucun.json") };
}

test("une clé collée dans un ticket est caviardée avant l'index, et signalée pour être révoquée, sans jamais être recopiée", async (t) => {
  const options = await corpusAvecUneCle(t);
  const bilan = await ingerer(options);
  assert.deepEqual(bilan.secrets, [{ id: "TK-2026-9201", regles: ["jeton GitHub", "clé OpenAI"] }]); // le sujet compris
  assert.match(bilan.documents[0].texte, /voici ma clé \[secret retiré\], qu'est-ce/);
  assert.equal(bilan.documents[0].titre, "Accès à l'outil de notes de frais (jeton [secret retiré])");
  const ecrit = (await readFile(options.sortie, "utf8")) + (await readFile(options.journal, "utf8"));
  assert.ok(!ecrit.includes(FAUSSES["clé OpenAI"]) && !ecrit.includes(FAUSSES["jeton GitHub"]));
  assert.match(ecrit, /SECRET TK-2026-9201 \(jeton GitHub, clé OpenAI\) caviardé, à révoquer/);
});

test("le pseudonyme dépend de la clé : sans elle, on ne le recalcule pas ; la clé n'est jamais écrasée, ni acceptée abîmée", async (t) => {
  const dossier = await mkdtemp(join(tmpdir(), "rhea-cle-"));
  t.after(() => rm(dossier, { recursive: true, force: true }));
  const chemin = join(dossier, "journal.cle");
  const cle = await cleDuJournal(chemin);
  assert.deepEqual(await cleDuJournal(chemin), cle); // relue, pas recréée
  assert.equal((await stat(chemin)).mode & 0o777, 0o600);
  for (const abimee of ["", "ab", "changez-moi"]) { // vide, tronquée, pas de l'hexadécimal : refusée, laissée telle quelle
    await writeFile(join(dossier, "abimee.cle"), abimee);
    await assert.rejects(cleDuJournal(join(dossier, "abimee.cle")), /64 caractères hexadécimaux attendus/);
    assert.equal(await readFile(join(dossier, "abimee.cle"), "utf8"), abimee);
  }
  const autre = Buffer.alloc(32, 1);
  assert.equal(pseudonyme("K0101", cle), pseudonyme("K0101", cle));
  assert.notEqual(pseudonyme("K0101", cle), pseudonyme("K0101", autre));
  assert.notEqual(pseudonyme("K0101", cle), pseudonyme("K0102", cle));
});

test("le journal efface les fichiers de plus de six mois, et seulement eux", async (t) => {
  const dossier = await mkdtemp(join(tmpdir(), "rhea-journal-"));
  t.after(() => rm(dossier, { recursive: true, force: true }));
  for (const nom of ["agent-2026-03-01.jsonl", "agent-2026-04-12.jsonl", "agent-2026-10-01.jsonl", "notes.txt"]) await writeFile(join(dossier, nom), "{}\n");
  assert.deepEqual(await purgerJournal(dossier, "2026-10-13"), ["agent-2026-03-01.jsonl"]); // limite : le 12 avril, gardé
  assert.deepEqual((await readdir(dossier)).sort(), ["agent-2026-04-12.jsonl", "agent-2026-10-01.jsonl", "notes.txt"]);
  // Et le journal purge de lui-même, au premier appel : un vieux fichier disparaît dès la première ligne écrite
  await writeFile(join(dossier, "agent-2026-01-01.jsonl"), "{}\n");
  const journaliser = journalJsonl(dossier, { cle: join(dossier, "journal.cle") });
  await journaliser({ horodatage: "2026-10-13T08:00:00.000Z", matricule: null, profil: "salarie", tour: 1, outil: "chercher_documents", champs: [], statut: "ok", duree_ms: 1, passages: [] });
  assert.ok(!(await readdir(dossier)).includes("agent-2026-01-01.jsonl"));
});

test("une question qui nomme un collègue ne laisse dans le journal ni son nom, ni le matricule, ni le texte rendu", async (t) => {
  const dossier = await mkdtemp(join(tmpdir(), "rhea-journal-"));
  t.after(() => rm(dossier, { recursive: true, force: true }));
  const ticket: Resultat = { id: "TK-2026-0066#1", document: "TK-2026-0066", titres: ["Salaire"], texte: "Question : le salaire de [nom] ?", score: 0.7 };
  // La fiche de l'organigramme porte un matricule dans son identifiant (chapitre 12)
  const fiche: Resultat = { id: "ORGANIGRAMME-K0042#1", document: "ORGANIGRAMME-K0042", titres: ["Organigramme"], texte: "…", score: 1 };
  let tours = 0;
  const llm: LlmAgent = async () =>
    ++tours === 1
      ? { texte: "", appels: [
          { id: "a", nom: "chercher_documents", arguments: { requete: "Quel est le salaire de Victor Laine ?", "Victor Laine": true } },
          { id: "b", nom: "dossier_K0099_Victor_Laine", arguments: {} }, // le LLM invente un outil : son nom vient de lui
        ], usage: { entree: 1, enCache: 0, sortie: 1 }, brut: [] }
      : { texte: "Je ne donne pas d'information sur un autre salarié.", appels: [], usage: { entree: 1, enCache: 0, sortie: 1 }, brut: [] };
  const journaliser = journalJsonl(dossier, { cle: join(dossier, "cle") });
  const agent = { llm, outils: [chercherDocuments(async () => [ticket, fiche])], systeme: "", journaliser };
  for await (const _ of agir("Quel est le salaire de Victor Laine ?", agent, { date: "2026-10-13", matricule: "K0006", profil: "rh" })) void _;
  const [fichier] = await readdir(dossier).then((noms) => noms.filter((n) => n.endsWith(".jsonl")));
  const brut = await readFile(join(dossier, fichier), "utf8");
  for (const absent of ["Victor", "Laine", "K0006", "K0042", "K0099", "salaire de"]) assert.ok(!brut.includes(absent), absent);
  const [entree, inconnu] = brut.trim().split("\n").map((ligne) => JSON.parse(ligne) as Omit<EntreeJournal, "matricule"> & { salarie: string });
  assert.deepEqual([inconnu.outil, inconnu.champs, inconnu.statut], ["inconnu", [], "erreur"]);
  assert.deepEqual([entree.outil, entree.profil, entree.champs, entree.passages[0], entree.statut], ["chercher_documents", "rh", ["requete"], "TK-2026-0066#1", "ok"]);
  assert.match(entree.passages[1], /^ORGANIGRAMME-[0-9a-f]{16}#1$/); // la référence garde sa forme, le matricule devient un pseudonyme
});
