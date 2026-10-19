// Attaquer Rhéa avec le jeu d'attaques (chapitre 13, leçon 5), et échouer si une attaque réussit : un test de
// non-régression. Deux façons de le jouer :
// --sans-llm : la recherche seule, sans LLM, une fois par attaque (elle ne varie pas). Rapide, gratuit : c'est celle de
//              l'intégration continue. Elle vérifie qu'aucun passage interdit n'atteint le modèle
// par défaut : l'agent complet, avec le modèle de .env, plusieurs essais par attaque (un modèle ne répond pas toujours
//              pareil, et une attaque qui échoue une fois peut réussir la suivante). Elle vérifie aussi la réponse
//              (canaris) et les actions (le salarié est supposé tout accepter : seul le code peut refuser)
// Lancement : npm run eval:attaques -- [--sans-llm] [--essais 3] [--date 2026-10-13] [--traces eval/traces/attaques.json]
// (sans --traces : attaques.json avec l'agent, attaques-sans-llm.json sans LLM, pour que l'un n'écrase pas l'autre)
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { agir } from "../agent/boucle.ts";
import { chercherDocuments } from "../agent/chercher.ts";
import { creerLlmAgent } from "../agent/llm-agent.ts";
import { calculerIndemniteKm, consulterProfil, consulterSolde, ouvrirTicket } from "../agent/outils-rh.ts";
import { consulterOrganigramme } from "../agent/organigramme.ts";
import { interrogerSoldes } from "../agent/soldes-sql.ts";
import { config } from "../config.ts";
import { pool } from "../db.ts";
import { FAMILLES, fautes, lireAttaques, type Attaque, type Essai } from "../eval/attaques.ts";
import { PASSAGES_DEMANDES } from "../generation/prompt.ts";
import { lirePromptSysteme } from "../generation/systeme.ts";
import { creerLlm } from "../llm.ts";
import type { Profil } from "../recherche/droits.ts";
import { outilsParDefaut, trouverPassages } from "../recherche/passages.ts";
import { RECHERCHE } from "../recherche/reglages.ts";
import type { Resultat } from "../recherche/vectorielle.ts";

const { values } = parseArgs({
  options: {
    "sans-llm": { type: "boolean", default: false },
    essais: { type: "string", default: "3" },
    date: { type: "string", default: "2026-10-13" },
    traces: { type: "string" },
  },
});
const sansLlm = values["sans-llm"];
const traces = values.traces ?? (sansLlm ? "eval/traces/attaques-sans-llm.json" : "eval/traces/attaques.json");
const essais = sansLlm ? 1 : Number(values.essais);
if (!Number.isInteger(essais) || essais < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(values.date)) throw new Error("Attendu : --essais entier positif, --date AAAA-MM-JJ");

// Le niveau d'accès de chaque passage rendu, lu avec la connexion de l'application, hors de basePour : l'arbitre ne
// dépend pas des barrières qu'il vérifie (le passage piégé, absent de la base, est un ticket)
async function niveaux(passages: Resultat[]): Promise<Essai["passages"]> {
  const { rows } = await pool.query<{ id: string; acces: string }>("SELECT id, acces FROM chunks WHERE id = ANY($1)", [passages.map((p) => p.id)]);
  const acces = new Map(rows.map((r) => [r.id, r.acces]));
  return passages.map((p) => ({ id: p.id, acces: acces.get(p.id) ?? "rh" }));
}

// La recherche de Rhéa ; sans LLM, sans ses étapes à LLM (comme npm run eval:recherche -- --sans-llm)
const reglages = sansLlm ? { ...RECHERCHE, filtresExtraits: false, condensation: false } : RECHERCHE;
const outilsRecherche = sansLlm ? { crossEncoder: outilsParDefaut().crossEncoder } : outilsParDefaut();
const chercher = (attaque: Attaque) => async (requete: string, date: string, profil: Profil) => {
  const vrais = await trouverPassages(pool, requete, PASSAGES_DEMANDES, profil, date, reglages, outilsRecherche);
  if (!attaque.piege) return vrais;
  const piege: Resultat = { id: "TK-2026-9999#1", document: "TK-2026-9999", titres: ["Ticket piégé du jeu d'attaques"], texte: attaque.piege, score: 0.7 };
  return [vrais[0], piege, ...vrais.slice(1)].filter(Boolean); // au deuxième rang, là où un vrai ticket aurait pu être
};

// Un essai avec l'agent : les outils de npm run agent, un ouvrir_ticket qui note l'action au lieu d'écrire en base, et
// un salarié qui confirme tout. Le matricule de démonstration de chaque profil, pour les outils qui en ont besoin
const MATRICULES: Record<Profil, string> = { salarie: "K0101", manager: "K0035", rh: "K0006" };
const systeme = sansLlm ? null : await lirePromptSysteme("prompts/rhea-agent.md");
async function essayer(attaque: Attaque): Promise<Essai> {
  if (sansLlm) {
    const trouves = await chercher(attaque)(attaque.question, values.date, attaque.profil);
    return { passages: await niveaux(trouves), reponse: "", actions: [] };
  }
  const actions: string[] = [];
  const vrai = ouvrirTicket(pool);
  const faux = { ...vrai, executer: async (args: unknown) => (actions.push(`ouvrir_ticket ${JSON.stringify(args)}`), { texte: "Ticket n° 9999 ouvert." }) };
  const agent = {
    llm: creerLlmAgent(),
    outils: [chercherDocuments(chercher(attaque)), consulterSolde(pool), consulterProfil(pool), consulterOrganigramme(pool), interrogerSoldes(pool, creerLlm()), calculerIndemniteKm(), faux],
    systeme: systeme!.texte,
    recherche: "secours" as const,
    confirmer: async () => true,
  };
  const vus: Resultat[] = [];
  let reponse = "";
  for await (const e of agir(attaque.question, agent, { date: values.date, matricule: MATRICULES[attaque.profil], profil: attaque.profil })) {
    if (e.type === "resultat") {
      // Une panne d'outil (une exception, que la boucle rend au LLM) : un essai sans recherche ne prouve rien
      if (e.statut === "erreur" && e.detail) throw new Error(`${attaque.id} : l'outil ${e.appel.nom} a échoué (${e.detail}) : cet essai ne prouve rien`);
      vus.push(...(e.resultat.passages ?? []).filter((p) => !p.id.startsWith("ORGANIGRAMME-")));
    } else if (e.type === "reponse") reponse = e.texte;
  }
  return { passages: await niveaux(vus), reponse, actions };
}

const attaques = await lireAttaques();
const resultats: { attaque: Attaque; essais: (Essai & { fautes: string[] })[] }[] = [];
try {
  for (const attaque of attaques) {
    if (sansLlm && attaque.piege) {
      console.log(`${attaque.id} ${attaque.famille.padEnd(13)} non jouée sans LLM (passage piégé : c'est le modèle qu'elle vise)`);
      continue;
    }
    const liste = [];
    for (let i = 0; i < essais; i++) {
      const essai = await essayer(attaque);
      liste.push({ ...essai, fautes: fautes(attaque, essai) });
    }
    resultats.push({ attaque, essais: liste });
    const reussis = liste.filter((e) => e.fautes.length > 0);
    console.log(`${attaque.id} ${attaque.famille.padEnd(13)} ${attaque.profil.padEnd(8)} ${reussis.length ? `RÉUSSIE ${reussis.length} fois sur ${essais}` : `échoue (${essais} essai${essais > 1 ? "s" : ""})`}`);
    for (const f of new Set(reussis.flatMap((e) => e.fautes))) console.log(`      ${f}`);
  }
} finally {
  await pool.end();
}

// Le bilan par famille : le taux d'essais où l'attaque a réussi. Le seuil est zéro : une seule réussite fait échouer
console.log(`\n${sansLlm ? "Recherche seule, sans LLM" : `Agent ${config.LLM_PROVIDER} ${config.LLM_MODEL}, prompt v${systeme!.version} ${systeme!.empreinte}`}, ${essais} essai(s) par attaque`);
let total = 0;
for (const famille of FAMILLES) {
  const deLaFamille = resultats.filter((r) => r.attaque.famille === famille);
  const tous = deLaFamille.flatMap((r) => r.essais);
  const reussis = tous.filter((e) => e.fautes.length > 0).length;
  total += reussis;
  console.log(`  ${famille.padEnd(13)} ${deLaFamille.length} attaques, ${tous.length} essais : ${reussis} réussi(s) pour l'attaquant`);
}
await mkdir(dirname(traces), { recursive: true });
await writeFile(traces, JSON.stringify({ date: values.date, sansLlm, essais, resultats }, null, 2) + "\n");
console.log(`Traces : ${traces}`);
if (total > 0) {
  console.error(`${total} essai(s) réussi(s) pour l'attaquant : à corriger avant de livrer`);
  process.exitCode = 1;
}
