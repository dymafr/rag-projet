// Tests de l'API en flux : les événements d'une question (le pipeline du chapitre 7, puis l'agent du chapitre 14), le
// serveur HTTP, l'interface et ses routes d'inspection, et le streaming de chaque API.
// Faux LLM et fausse recherche : ni clé, ni base, ni réseau. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import type { Agent } from "../src/agent/boucle.ts";
import { chercherDocuments } from "../src/agent/chercher.ts";
import type { LlmAgent, Message, ReponseAgent } from "../src/agent/llm-agent.ts";
import { definirOutil, type Outil } from "../src/agent/outil.ts";
import type { Session } from "../src/api/agent.ts";
import { Confirmations } from "../src/api/confirmations.ts";
import type { Inspection } from "../src/api/inspection.ts";
import { repondreEnFlux, type Dependances, type Evenement } from "../src/api/rhea.ts";
import { creerServeur, evenementSSE, type DependancesServeur } from "../src/api/serveur.ts";
import { streamerAvecClaude } from "../src/generation/claude.ts";
import type { GenerateurEnFlux, Morceau } from "../src/generation/generateur.ts";
import { streamerAvecResponses } from "../src/generation/openai.ts";
import type { PromptAugmente } from "../src/generation/prompt.ts";
import type { Profil } from "../src/recherche/droits.ts";
import type { Resultat } from "../src/recherche/vectorielle.ts";
import { z } from "zod";

const faq: Resultat = { id: "FAQ-RH#2", document: "FAQ-RH", titres: ["FAQ RH de Kalyo", "Télétravail"], texte: "Jusqu'à trois jours par semaine.", score: 0.888 };
const usage = { entree: 900, enCache: 0, sortie: 12 };

// 1. Le pipeline du chapitre 7 (src/api/rhea.ts), que gardent les outils d'évaluation du chapitre 8
const llm = (...morceaux: Morceau[]): GenerateurEnFlux =>
  async function* () {
    yield* morceaux;
  };
const pipeline = (generer: GenerateurEnFlux, score = 0.888, budget = 1500): Dependances => ({
  chercher: async () => [{ ...faq, score }],
  generer,
  systeme: { version: "1", texte: "Tu es Rhéa.", empreinte: "abcd1234" },
  budget,
  date: () => "2026-10-05",
});
async function evenements(flux: AsyncGenerator<Evenement>) {
  const liste: Evenement[] = [];
  for await (const e of flux) liste.push(e);
  return liste;
}

test("evenementSSE écrit le nom, les données en JSON sur une ligne, puis une ligne vide", () => {
  assert.equal(evenementSSE("texte", { texte: "Trois" }), 'event: texte\ndata: {"texte":"Trois"}\n\n');
});

test("repondreEnFlux envoie le texte au fil de l'écriture, puis les sources citées, puis la fin", async () => {
  const generer = llm({ type: "texte", texte: "Trois jours " }, { type: "texte", texte: "[1]." }, { type: "fin", usage });
  const liste = await evenements(repondreEnFlux("Combien de jours ?", "salarie", pipeline(generer)));
  assert.deepEqual(liste.map((e) => e.nom), ["texte", "texte", "sources", "fin"]);
  assert.deepEqual(liste[2].donnees, [{ numero: 1, source: "FAQ-RH#2", titre: "FAQ RH de Kalyo > Télétravail", extraits: [] }]);
  assert.deepEqual(liste[3].donnees, { usage, prompt: "v1 abcd1234" });
});

test("repondreEnFlux s'abstient sans appeler le LLM sous le seuil, ou quand aucun passage ne tient dans le budget", async () => {
  let appels = 0;
  const generer: GenerateurEnFlux = async function* () {
    appels++;
  };
  const loin = await evenements(repondreEnFlux("Quelle météo ?", "salarie", pipeline(generer, 0.4)));
  assert.deepEqual(loin.map((e) => e.nom), ["abstention", "fin"]);
  const sansPassage = await evenements(repondreEnFlux("Combien de jours ?", "salarie", pipeline(generer, 0.888, 5)));
  assert.deepEqual(sansPassage.map((e) => e.nom), ["abstention", "fin"]);
  assert.equal(appels, 0);
});

test("repondreEnFlux demande de remplacer une réponse sans source vérifiable", async () => {
  const sansNumero = await evenements(repondreEnFlux("Rachat ?", "salarie", pipeline(llm({ type: "texte", texte: "Je ne sais pas." }, { type: "fin", usage }))));
  assert.deepEqual(sansNumero.map((e) => e.nom), ["texte", "sources", "abstention", "fin"]);
  const citationFausse = llm({ type: "texte", texte: "Quatre jours." }, { type: "citation", citation: { numero: 1, texteCite: "Quatre jours par semaine." } }, { type: "fin", usage });
  const liste = await evenements(repondreEnFlux("Combien ?", "salarie", pipeline(citationFausse)));
  assert.deepEqual(liste.map((e) => e.nom), ["texte", "sources", "abstention", "fin"]);
});

test("repondreEnFlux ignore une citation qui désigne un passage absent", async () => {
  const horsLimites = llm({ type: "texte", texte: "Trois jours [1]." }, { type: "citation", citation: { numero: 3, texteCite: "?" } }, { type: "fin", usage });
  const liste = await evenements(repondreEnFlux("Combien ?", "salarie", pipeline(horsLimites)));
  const sources = liste.find((e) => e.nom === "sources")!.donnees as { numero: number }[];
  assert.deepEqual(sources.map((s) => s.numero), [1]);
});

test("repondreEnFlux condense une question de suite, cherche la question autonome et l'annonce à la page", async () => {
  let cherchee = "";
  const d: Dependances = {
    ...pipeline(llm({ type: "texte", texte: "Huit jours [1]." }, { type: "fin", usage })),
    chercher: async (question) => {
      cherchee = question;
      return [faq];
    },
    condenser: async () => "Combien de RTT ai-je par an à 80 % ?",
  };
  const historique = [{ question: "Combien de RTT ai-je par an ?", reponse: "10 jours pour un temps plein [1]." }];
  const liste = await evenements(repondreEnFlux("Et à 80 % ?", "salarie", d, undefined, historique));
  assert.deepEqual(liste[0], { nom: "question", donnees: { question: "Combien de RTT ai-je par an à 80 % ?" } });
  assert.equal(cherchee, "Combien de RTT ai-je par an à 80 % ?");
  const seule = await evenements(repondreEnFlux("Combien de RTT ai-je par an ?", "salarie", d));
  assert.equal(cherchee, "Combien de RTT ai-je par an ?");
  assert.ok(!seule.some((e) => e.nom === "question"));
});

// 2. Le serveur du chapitre 14 : l'agent, avec un faux LLM qui rend, tour après tour, les réponses données
const appelRecherche = (id = "a1"): ReponseAgent => ({ texte: "", appels: [{ id, nom: "chercher_documents", arguments: { requete: "jours de télétravail" } }], usage, brut: [] });
const reponseFinale = (texte = "Trois jours par semaine [FAQ-RH#2]."): ReponseAgent => ({ texte, appels: [], usage, brut: [] });
function fauxLlm(...reponses: ReponseAgent[]): { llm: LlmAgent; recus: Message[][] } {
  const recus: Message[][] = [];
  let i = 0;
  const llm: LlmAgent = async (_systeme, messages) => {
    recus.push(structuredClone(messages));
    return reponses[Math.min(i++, reponses.length - 1)];
  };
  return { llm, recus };
}
const ANNUAIRE: Record<string, Profil> = { K0101: "salarie", K0035: "manager" }; // deux salariés connus (chapitre 13)
const TARIFS = { date: "2026-10-20", source: "https://exemple.test/prix", modeles: { "anthropic claude-test": { entree: 2, enCache: 0.1, sortie: 10 } }, fileSearchPour1000: 0 };

type Reglage = { llm?: LlmAgent; outils?: Outil[]; inspection?: boolean; inspecter?: Inspection; web?: string; sessions?: Session[] };
function serveurDeTest(r: Reglage = {}): DependancesServeur {
  const llmAgent = r.llm ?? fauxLlm(appelRecherche(), reponseFinale()).llm;
  const outils = r.outils ?? [chercherDocuments(async () => [faq])];
  return {
    agent: (session, confirmer): Agent => {
      r.sessions?.push(session);
      return { llm: llmAgent, outils, systeme: "Tu es Rhéa.", recherche: "libre", modele: { fournisseur: "anthropic", modele: "claude-test" }, confirmer };
    },
    confirmations: new Confirmations(),
    profil: async (matricule) => ANNUAIRE[matricule] ?? null,
    date: () => "2026-10-20",
    version: "v7 abcd1234",
    tarifs: TARIFS,
    inspection: r.inspection ?? true,
    inspecter: r.inspecter,
    web: r.web,
  };
}

// Un serveur de test sur un port libre, arrêté à la fin
async function avecServeur(d: DependancesServeur, essai: (adresse: string) => Promise<void>) {
  const serveur = creerServeur(d);
  await new Promise<void>((pret) => serveur.listen(0, "127.0.0.1", pret));
  try {
    await essai(`http://127.0.0.1:${(serveur.address() as AddressInfo).port}`);
  } finally {
    serveur.close();
  }
}
const ENTETES_JSON = { "Content-Type": "application/json", "X-Matricule": "K0101" }; // le salarié connecté (chapitre 13)
const poser = (adresse: string, corps: object = { question: "Combien de jours de télétravail ?" }, entetes: Record<string, string> = ENTETES_JSON) =>
  fetch(`${adresse}/ask`, { method: "POST", headers: entetes, body: JSON.stringify(corps) });

// Les événements d'un flux SSE, lus dans l'ordre
function lireSSE(corps: string): { nom: string; donnees: any }[] {
  return corps
    .split("\n\n")
    .filter(Boolean)
    .map((bloc) => {
      const [, nom] = /^event: (.+)$/m.exec(bloc)!;
      const [, donnees] = /^data: (.+)$/m.exec(bloc)!;
      return { nom, donnees: JSON.parse(donnees) };
    });
}

test("le serveur répond avec l'agent : chaque étape de la trace, puis le texte, les sources citées et le coût", async () => {
  await avecServeur(serveurDeTest(), async (adresse) => {
    const flux = await poser(adresse);
    assert.equal(flux.headers.get("content-type"), "text/event-stream");
    const liste = lireSSE(await flux.text());
    assert.deepEqual(liste.filter((e) => e.nom !== "etape").map((e) => e.nom), ["texte", "sources", "fin"]);
    // Chaque étape commence avant de finir ; la recherche se range dans l'appel d'outil qui l'a lancée
    const fins = liste.filter((e) => e.nom === "etape" && e.donnees.type === "fin").map((e) => e.donnees.etape);
    assert.deepEqual(fins.map((e: { nom: string }) => e.nom), ["prompt-systeme", "tour-llm", "seuil", "budget", "outil", "tour-llm", "reponse", "citations"]);
    const outil = fins.find((e: { nom: string }) => e.nom === "outil");
    assert.deepEqual(fins.filter((e: { parent: number }) => e.parent === outil.id).map((e: { nom: string }) => e.nom), ["seuil", "budget"]);
    assert.equal(liste.filter((e) => e.nom === "etape" && e.donnees.type === "debut").length, fins.length);
    assert.deepEqual(fins[1].usage, usage);
    assert.deepEqual(fins[1].modele, { fournisseur: "anthropic", modele: "claude-test" });
    const sources = liste.find((e) => e.nom === "sources")!.donnees;
    assert.deepEqual(sources, { citees: [{ id: "FAQ-RH#2", document: "FAQ-RH", titre: "FAQ RH de Kalyo > Télétravail", score: 0.888, texte: faq.texte }], inventees: [] });
    const fin = liste.find((e) => e.nom === "fin")!.donnees;
    assert.deepEqual(fin.usage, { entree: 1800, enCache: 0, sortie: 24 });
    assert.deepEqual(fin.cout, { min: 0.00384, max: 0.00384 }); // 1 800 tokens à 2 $, 24 à 10 $, par million
    assert.deepEqual([fin.prompt, fin.tours, fin.modele.modele], ["v7 abcd1234", 2, "claude-test"]);
    // Une question vide, du texte qui n'est pas du JSON : refusés avant tout appel
    const vide = await poser(adresse, { question: "  " });
    assert.deepEqual([vide.status, await vide.json()], [400, { erreur: "la question est vide" }]);
    assert.equal((await fetch(`${adresse}/ask`, { method: "POST", headers: ENTETES_JSON, body: "pas du JSON" })).status, 400);
  });
});

test("le serveur signale une source que le LLM cite sans qu'aucun outil l'ait rendue", async () => {
  const { llm: inventeur } = fauxLlm(appelRecherche(), reponseFinale("Quatre jours [POL-TT-09#1]."));
  await avecServeur(serveurDeTest({ llm: inventeur }), async (adresse) => {
    const sources = lireSSE(await (await poser(adresse)).text()).find((e) => e.nom === "sources")!.donnees;
    assert.deepEqual(sources, { citees: [], inventees: ["POL-TT-09#1"] });
  });
});

test("sans le mode inspection, aucune étape ne part au navigateur, et les routes /api n'existent pas", async () => {
  await avecServeur(serveurDeTest({ inspection: false }), async (adresse) => {
    const liste = lireSSE(await (await poser(adresse)).text());
    assert.deepEqual(liste.map((e) => e.nom), ["texte", "sources", "fin"]);
    assert.equal((await fetch(`${adresse}/api/configuration`)).status, 404);
  });
});

test("le serveur transmet l'historique de la conversation à l'agent, et refuse un historique mal formé ou trop long", async () => {
  const { llm: lecteur, recus } = fauxLlm(reponseFinale("Huit jours."));
  await avecServeur(serveurDeTest({ llm: lecteur }), async (adresse) => {
    const historique = [{ question: "Combien de RTT ?", reponse: "10 jours." }];
    await (await poser(adresse, { question: "Et à 80 % ?", historique })).text();
    assert.deepEqual(recus[0].slice(0, 2), [
      { role: "utilisateur", texte: "Combien de RTT ?" },
      { role: "assistant", texte: "10 jours.", appels: [] },
    ]);
    const mal = await poser(adresse, { question: "Et ?", historique: [{ question: "?" }] });
    assert.deepEqual([mal.status, await mal.json()], [400, { erreur: "historique : chaque réponse doit être un texte" }]);
    const long = Array.from({ length: 4 }, () => ({ question: "Combien ?", reponse: "…" }));
    assert.deepEqual(await (await poser(adresse, { question: "Et ?", historique: long })).json(), { erreur: "historique trop long : 3 échanges au plus" });
  });
});

test("le serveur exige le salarié connecté (401), refuse un matricule inconnu (403) et assemble l'agent pour son profil", async () => {
  const sessions: Session[] = [];
  await avecServeur(serveurDeTest({ sessions }), async (adresse) => {
    const avec = (entetes: Record<string, string>, corps?: object) => poser(adresse, corps, { "Content-Type": "application/json", ...entetes });
    assert.equal((await avec({})).status, 401);
    assert.equal((await avec({ "X-Matricule": "Morgane" })).status, 401);
    assert.equal((await avec({ "X-Matricule": "K9999" })).status, 403);
    // Le client ne choisit pas son profil : une clé de plus dans le corps est refusée
    assert.equal((await avec({ "X-Matricule": "K0101" }, { question: "Combien ?", profil: "rh" })).status, 400);
    await (await avec({ "X-Matricule": "K0035" })).text();
    await (await avec({ "X-Matricule": "K0101" })).text();
    assert.deepEqual(sessions, [{ matricule: "K0035", profil: "manager" }, { matricule: "K0101", profil: "salarie" }]); // rien pour les refus
  });
});

test("le serveur refuse un corps qui n'est pas déclaré en JSON (415), comme celui qu'enverrait un autre site", async () => {
  await avecServeur(serveurDeTest(), async (adresse) => {
    assert.equal((await fetch(`${adresse}/ask`, { method: "POST", body: JSON.stringify({ question: "Combien ?" }) })).status, 415);
    assert.equal((await fetch(`${adresse}/ask/confirmation`, { method: "POST", body: "{}" })).status, 415);
  });
});

test("en mode inspection, le serveur joint sur cette machine refuse un autre nom d'hôte (DNS rebinding)", async () => {
  // fetch ne laisse pas choisir l'en-tête Host : une requête http à la main
  const statut = (adresse: string, hote: string) =>
    new Promise<number>((fini, echec) => {
      const requete = http.get({ host: "127.0.0.1", port: new URL(adresse).port, path: "/inconnue", headers: { Host: hote } }, (reponse) => {
        reponse.resume();
        fini(reponse.statusCode!);
      });
      requete.on("error", echec);
    });
  await avecServeur(serveurDeTest(), async (adresse) => {
    assert.equal(await statut(adresse, "piege.example"), 403);
    assert.equal(await statut(adresse, `localhost:${new URL(adresse).port}`), 404); // accepté : la route n'existe pas
  });
  await avecServeur(serveurDeTest({ inspection: false }), async (adresse) => {
    assert.equal(await statut(adresse, "piege.example"), 404); // sans inspection (en production) : le proxy filtre
  });
});

test("une action attend l'accord du salarié : le serveur le demande, et seul ce salarié peut répondre", async () => {
  let fait = 0;
  const ticket = definirOutil({
    nom: "ouvrir_ticket",
    description: "Ouvre un ticket",
    parametres: z.object({ objet: z.string() }),
    aConfirmer: ({ objet }) => `ouvrir un ticket « ${objet} »`,
    executer: async () => (fait++, { texte: "Ticket ouvert." }),
  });
  const demande: ReponseAgent = { texte: "", appels: [{ id: "t1", nom: "ouvrir_ticket", arguments: { objet: "Badge perdu" } }], usage, brut: [] };
  for (const [qui, accord, attendu] of [["K0101", true, 1], ["K0035", true, 0], ["K0101", false, 0]] as const) {
    fait = 0;
    const { llm: demandeur } = fauxLlm(demande, reponseFinale("C'est fait."));
    await avecServeur(serveurDeTest({ llm: demandeur, outils: [ticket] }), async (adresse) => {
      const reponse = await poser(adresse, { question: "Ouvre un ticket pour mon badge perdu" });
      const lecteur = reponse.body!.pipeThrough(new TextDecoderStream()).getReader();
      let lu = "";
      while (!lu.includes("event: confirmation")) lu += (await lecteur.read()).value;
      const { id, action } = lireSSE(lu).find((e) => e.nom === "confirmation")!.donnees;
      assert.equal(action, "ouvrir un ticket « Badge perdu »");
      const entetes = { "Content-Type": "application/json", "X-Matricule": qui };
      const statut = (await fetch(`${adresse}/ask/confirmation`, { method: "POST", headers: entetes, body: JSON.stringify({ id, accord }) })).status;
      assert.equal(statut, qui === "K0101" ? 200 : 404); // un autre salarié ne peut pas répondre à sa place
      if (qui !== "K0101") {
        const refus = { "Content-Type": "application/json", "X-Matricule": "K0101" };
        await fetch(`${adresse}/ask/confirmation`, { method: "POST", headers: refus, body: JSON.stringify({ id, accord: false }) });
      }
      while (!(await lecteur.read()).done);
    });
    assert.equal(fait, attendu);
  }
});

test("le serveur garde le détail d'une erreur pour son terminal, caviardé, et envoie un message générique", async () => {
  const cle = `sk-proj-${"Ab3".repeat(16)}`; // une fausse clé, assemblée ici pour ne pas alerter les scanners de secrets
  const enPanne: LlmAgent = async () => {
    throw new Error(`401 Incorrect API key provided: ${cle}`);
  };
  const journal = console.error;
  const terminal: string[] = [];
  console.error = (...args: unknown[]) => void terminal.push(args.join(" ")); // ce que le serveur écrit dans son terminal
  try {
    await avecServeur(serveurDeTest({ llm: enPanne }), async (adresse) => {
      const corps = await (await poser(adresse)).text();
      assert.match(corps, /event: erreur\ndata: \{"message":"Rhéa n'a pas pu terminer sa réponse/);
      // La trace, elle, note l'échec du tour, caviardé : rien de la clé ne part, même en mode inspection
      assert.doesNotMatch(corps, /sk-proj/);
    });
    const annuaireEnPanne = { ...serveurDeTest(), profil: async () => { throw new Error(`annuaire injoignable, clé ${cle}`); } };
    await avecServeur(annuaireEnPanne, async (adresse) => {
      const reponse = await poser(adresse);
      assert.equal(reponse.status, 500);
      assert.doesNotMatch(await reponse.text(), /sk-proj/);
    });
  } finally {
    console.error = journal;
  }
  assert.match(terminal.join("\n"), /401 Incorrect API key provided: \[secret retiré\]/);
  assert.match(terminal.join("\n"), /annuaire injoignable, clé \[secret retiré\]/);
  assert.ok(!terminal.join("\n").includes(cle));
});

test("le serveur sert l'interface construite, avec sa politique de sécurité, sans jamais sortir de son dossier", async () => {
  const web = await mkdtemp(join(tmpdir(), "rhea-web-"));
  try {
    await mkdir(join(web, "assets"));
    await writeFile(join(web, "index.html"), "<!doctype html><title>Rhéa</title>");
    await writeFile(join(web, "assets", "app-1a2b.js"), "console.log('Rhéa')");
    await avecServeur(serveurDeTest({ web }), async (adresse) => {
      const page = await fetch(`${adresse}/`);
      assert.match(await page.text(), /<title>Rhéa/);
      assert.match(page.headers.get("content-security-policy")!, /default-src 'self'/);
      assert.equal(page.headers.get("cache-control"), "no-cache");
      // Une adresse de l'interface (une vue) rend la même page ; un fichier, son contenu, gardé en cache
      assert.match(await (await fetch(`${adresse}/evaluations`)).text(), /<title>Rhéa/);
      const script = await fetch(`${adresse}/assets/app-1a2b.js`);
      assert.equal(script.headers.get("content-type"), "text/javascript; charset=utf-8");
      assert.match(script.headers.get("cache-control")!, /immutable/);
      assert.equal((await fetch(`${adresse}/assets/absent.js`)).status, 404);
      // Des barres encodées (%2F) : l'adresse garde ses .., que seul le serveur décode. Il refuse de sortir de son dossier
      const sortie = await fetch(`${adresse}/..%2F..%2Fpackage.json`);
      assert.equal(sortie.status, 404);
      assert.doesNotMatch(await sortie.text(), /"name"/);
    });
  } finally {
    await rm(web, { recursive: true, force: true });
  }
});

test("les routes d'inspection lisent avec le profil du salarié connecté, et ne trahissent pas un document réservé", async () => {
  const profils: string[] = [];
  const inspecter: Inspection = {
    salaries: async () => [{ matricule: "K0101", prenom: "Morgane", nom: "Moreau", role: "salarie", site: "lyon", service: "Développement", poste: "Développeuse" }],
    configuration: async () => ({ generation: { fournisseur: "ollama" } }) as unknown as Awaited<ReturnType<Inspection["configuration"]>>,
    documents: async (profil) => (profils.push(profil), []),
    passagesDuDocument: async (document, profil) => (profils.push(profil), document === "FAQ-RH" ? [] : []),
    passage: async (id, profil) => (profils.push(profil), id === "FAQ-RH#2" ? { id, document: "FAQ-RH", titres: [], texte: faq.texte, taille: 9, type: "faq", acces: "tous", date_effet: "2026-03-01", date_fin: null } : null),
    rechercher: async (question, date, profil) => (profils.push(`${profil} ${date} ${question}`), { passages: [], trace: [] }),
    evaluations: async () => [],
    evaluation: async (nom) => (nom === "caché" ? "cache" : null),
    resultat: async (nom) => (nom === "secret" ? "cache" : null),
    desaccords: async () => null,
    etiqueter: async () => false,
    observations: async () => ({ jours: [], derive: { recents: { questions: 0, sansSource: null, meilleurScore: null, negatifs: null }, avant: { questions: 0, sansSource: null, meilleurScore: null, negatifs: null }, alertes: [] } }),
  };
  await avecServeur(serveurDeTest({ inspecter }), async (adresse) => {
    assert.equal((await (await fetch(`${adresse}/api/salaries`)).json())[0].matricule, "K0101");
    assert.equal((await fetch(`${adresse}/api/documents`)).status, 401); // les documents demandent un salarié connecté
    const lire = (chemin: string) => fetch(`${adresse}${chemin}`, { headers: { "X-Matricule": "K0035" } });
    assert.equal((await lire("/api/documents")).status, 200);
    assert.equal((await lire("/api/documents/MGR-PR-01")).status, 404); // réservé ou inexistant : même réponse
    assert.equal((await (await lire("/api/passages/FAQ-RH%232")).json()).id, "FAQ-RH#2");
    assert.equal((await lire("/api/passages/FAQ-RH%239")).status, 404);
    const recherche = await fetch(`${adresse}/api/rechercher`, { method: "POST", headers: { ...ENTETES_JSON }, body: JSON.stringify({ question: "Télétravail ?" }) });
    assert.equal(recherche.status, 200);
    assert.equal((await lire("/api/inconnue")).status, 404);
    // Une évaluation du jeu caché ne livre ni sa liste de questions, ni une question
    assert.deepEqual(await (await fetch(`${adresse}/api/evaluations`)).json(), []);
    assert.equal((await fetch(`${adresse}/api/evaluations/secret/questions/H001`)).status, 403);
    assert.equal((await fetch(`${adresse}/api/evaluations/base/questions/Q01`)).status, 404);
    assert.equal((await fetch(`${adresse}/api/evaluations/..%2Fsecret`)).status, 404);
  });
  assert.deepEqual(profils, ["manager", "manager", "manager", "manager", "salarie 2026-10-20 Télétravail ?"]);
});

// 3. Le streaming de chaque API (chapitre 7)
const prompt: PromptAugmente = { systeme: "Tu es Rhéa.", utilisateur: "…", passages: [faq], ecartes: [], question: "Combien ?", date: "2026-10-05" };
async function morceaux(flux: AsyncGenerator<Morceau>) {
  const liste: Morceau[] = [];
  for await (const m of flux) liste.push(m);
  return liste;
}
const clientOpenAI = (evenementsOpenAI: object[], appels: unknown[][] = []) =>
  ({ responses: { create: async (...args: unknown[]) => (appels.push(args), evenementsOpenAI) } }) as unknown as OpenAI;
const fin = (output_tokens: number) => ({ type: "response.completed", response: { usage: { input_tokens: 900, input_tokens_details: { cached_tokens: 0 }, output_tokens } } });

test("streamerAvecResponses demande un flux, passe le signal et rend les morceaux de texte puis la fin", async () => {
  const appels: unknown[][] = [];
  const evenementsOpenAI = [{ type: "response.output_text.delta", delta: "Trois" }, { type: "response.output_text.delta", delta: " jours [1]." }, fin(12)];
  const signal = new AbortController().signal;
  const liste = await morceaux(streamerAvecResponses(clientOpenAI(evenementsOpenAI, appels), "modele-test", prompt, {}, signal));
  assert.deepEqual(liste, [{ type: "texte", texte: "Trois" }, { type: "texte", texte: " jours [1]." }, { type: "fin", usage }]);
  assert.equal((appels[0][0] as { stream: boolean }).stream, true);
  assert.equal((appels[0][1] as { signal: AbortSignal }).signal, signal);
});

test("streamerAvecResponses signale un flux coupé avant la fin, une réponse coupée par la limite et un refus", async () => {
  const delta = { type: "response.output_text.delta", delta: "Trois" };
  await assert.rejects(morceaux(streamerAvecResponses(clientOpenAI([delta, delta]), "m", prompt)), /Flux interrompu/);
  await assert.rejects(morceaux(streamerAvecResponses(clientOpenAI([delta, fin(1024)]), "m", prompt, { max_output_tokens: 1024 })), /limite de tokens/);
  await assert.rejects(morceaux(streamerAvecResponses(clientOpenAI([{ type: "response.refusal.done", refusal: "Non." }]), "m", prompt)), /Refus du modèle : Non\./);
});

const clientClaude = (evenementsClaude: object[], message: object) =>
  ({ messages: { stream: () => ({ [Symbol.asyncIterator]: async function* () { yield* evenementsClaude; }, finalMessage: async () => message }) } }) as unknown as Anthropic;

test("streamerAvecClaude rend le texte, les citations, et [n] à la fin de chaque bloc cité", async () => {
  const evenementsClaude = [
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Trois jours." } },
    { type: "content_block_delta", index: 0, delta: { type: "citations_delta", citation: { type: "search_result_location", cited_text: "Jusqu'à trois jours par semaine.", search_result_index: 0 } } },
    { type: "content_block_stop", index: 0 },
  ];
  const client = clientClaude(evenementsClaude, { stop_reason: "end_turn", usage: { input_tokens: 900, output_tokens: 12 } });
  const liste = await morceaux(streamerAvecClaude(client, "modele-test", prompt));
  assert.deepEqual(liste, [
    { type: "texte", texte: "Trois jours." },
    { type: "citation", citation: { numero: 1, texteCite: "Jusqu'à trois jours par semaine." } },
    { type: "texte", texte: "[1]" },
    { type: "fin", usage },
  ]);
});

test("streamerAvecClaude signale un refus avec son explication", async () => {
  const client = clientClaude([], { stop_reason: "refusal", stop_details: { explanation: "contenu refusé" }, usage: { input_tokens: 900, output_tokens: 0 } });
  await assert.rejects(morceaux(streamerAvecClaude(client, "modele-test", prompt)), /Réponse interrompue : refusal \(contenu refusé\)/);
});

test("Claude : les tokens écrits dans le cache comptent dans l'entrée et à part, pour leur prix (chapitre 14)", async () => {
  const client = clientClaude([], { stop_reason: "end_turn", usage: { input_tokens: 100, cache_creation_input_tokens: 700, cache_read_input_tokens: 0, output_tokens: 12 } });
  const liste = await morceaux(streamerAvecClaude(client, "modele-test", prompt));
  assert.deepEqual(liste.at(-1), { type: "fin", usage: { entree: 800, enCache: 0, sortie: 12, ecritCache: 700 } });
});
