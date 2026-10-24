// Poser une question à Rhéa en agent : le LLM décide s'il cherche, et quoi. Chaque étape s'affiche : les appels
// d'outil demandés, leurs résultats, puis la réponse et ses sources
// Lancement : npm run agent -- "votre question" [--matricule K0101] [--date 2026-10-13] [--tours 5] [--recherche secours]
//             [--oui] (accepter d'office les actions, pour une démo enregistrée)
//             [--sources fichiers] (leçon 7 : chercher sans vecteurs, dans donnees/textes, avec les outils d'un agent de code)
// --matricule : le salarié connecté. Il n'y a pas de vraie connexion dans ce projet : l'option la simule. Son profil, lu
// dans l'annuaire, décide des documents que la recherche peut lire (chapitre 13) ; sans matricule, ceux ouverts à tous
// Chaque appel d'outil s'ajoute au journal du jour, dans journal/ (leçon 5) : des références et un pseudonyme, gardés
// six mois (chapitre 13)
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { agir, TOURS_MAX, type Recherche } from "../agent/boucle.ts";
import { journalJsonl } from "../agent/journal.ts";
import type { AppelOutil } from "../agent/llm-agent.ts";
import { DOSSIER_TEXTES, outilsFichiers } from "../agent/fichiers.ts";
import { assemblerRhea, outilsDeRhea, PROMPT_AGENT } from "../agent/rhea.ts";
import { fichiersCites, sourcesCitees } from "../agent/sources.ts";
import { config } from "../config.ts";
import { pool } from "../db.ts";
import { lirePromptSysteme } from "../generation/systeme.ts";
import { pourLeTerminal } from "../ingestion/secrets.ts";
import { profilDeSession } from "../recherche/droits.ts";
import { aujourdhui } from "../recherche/passages.ts";
import type { Resultat } from "../recherche/vectorielle.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  allowNegative: true,
  options: {
    date: { type: "string", default: aujourdhui() },
    matricule: { type: "string" },
    recherche: { type: "string", default: "secours" }, // libre, office ou secours : qui décide de la première recherche
    tours: { type: "string", default: String(TOURS_MAX) },
    oui: { type: "boolean", default: false },
    sources: { type: "string", default: "documents" }, // documents (la recherche de Rhéa) ou fichiers (leçon 7)
  },
});
const question = (positionals[0] ?? "Combien de jours de télétravail ai-je par semaine ?").trim();
const toursMax = Number(values.tours);
if (!["libre", "office", "secours"].includes(values.recherche)) throw new Error("--recherche attend libre, office ou secours");
if (!["documents", "fichiers"].includes(values.sources)) throw new Error("--sources attend documents ou fichiers");
const surFichiers = values.sources === "fichiers";
const matriculeValide = values.matricule === undefined || /^K\d{4}$/.test(values.matricule);
if (!question || !/^\d{4}-\d{2}-\d{2}$/.test(values.date) || !Number.isInteger(toursMax) || toursMax < 1 || !matriculeValide) {
  console.error("Attendu : une question, --date au format AAAA-MM-JJ, --tours entier positif, --matricule au format K0101");
  process.exit(1);
}

const systeme = await lirePromptSysteme(surFichiers ? "prompts/rhea-fichiers.md" : PROMPT_AGENT);
// Chapitre 14 : les outils de Rhéa, ceux du serveur et de l'évaluation. Chapitre 10, leçon 7 : sur fichiers, les trois
// outils d'un agent de code remplacent la recherche de Rhéa
const outils = surFichiers
  ? [...outilsFichiers(DOSSIER_TEXTES), ...outilsDeRhea(pool).filter((o) => o.nom !== "chercher_documents")]
  : outilsDeRhea(pool);

// La confirmation, dans le terminal : le salarié lit l'action et répond. Sans terminal (une commande lancée par un script),
// personne ne peut répondre : l'action est refusée, sauf avec --oui
async function confirmer(_appel: AppelOutil, action: string): Promise<boolean> {
  if (values.oui) {
    console.log(`         ? Rhéa veut ${action}. Accepté d'office (--oui)`);
    return true;
  }
  if (!process.stdin.isTTY) {
    console.log(`         ? Rhéa veut ${action}. Refusé : personne pour confirmer`);
    return false;
  }
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  const reponse = await terminal.question(`         ? Rhéa veut ${action}. Confirmez-vous ? (o/N) `);
  terminal.close();
  return /^o(ui)?$/i.test(reponse.trim());
}
// Chapitre 12, leçon 2 : avec un salarié connecté, sa fiche de l'organigramme d'office (son manager, sa chaîne). Essai
// du 17 octobre : à « Qui est mon manager ? », le modèle local répondait sans appeler l'outil, faute de savoir qui est le
// salarié ; pour un collègue nommé, il l'appelait de lui-même. assemblerRhea le fait dès qu'un matricule est donné
const agent = assemblerRhea(outils, {
  systeme: systeme.texte,
  matricule: values.matricule,
  toursMax,
  // La recherche imposée passe par chercher_documents : sur fichiers, le LLM décide seul
  recherche: (surFichiers ? "libre" : values.recherche) as Recherche,
  confirmer,
  journaliser: journalJsonl(),
});

const secondes = (ms: number) => (ms / 1000).toFixed(1);
// Ce que l'outil a rendu, en une ligne : les passages et le meilleur d'entre eux, ou le début du texte
function resume(resultat: { texte: string; passages?: Resultat[] }, erreur: boolean): string {
  if (erreur) return `ERREUR : ${resultat.texte.split("\n").join(" ")}`;
  const passages = resultat.passages ?? [];
  if (passages.length > 0) return `${passages.length} passages, le premier : ${passages[0].id} (score ${passages[0].score.toFixed(3)})`;
  const ligne = resultat.texte.replace(/\s+/g, " ");
  return ligne.length > 100 ? `${ligne.slice(0, 100)}…` : ligne;
}

const profil = await profilDeSession(pool, values.matricule);
const qui = values.matricule ? `salarié ${values.matricule}, profil ${profil}` : "aucun salarié connecté, profil salarie";
console.log(`« ${question} »  (${config.LLM_PROVIDER}, prompt v${systeme.version} ${systeme.empreinte}, date ${values.date}, ${qui})\n`);
const vus: Resultat[] = []; // tous les passages rendus par les outils : seules leurs sources peuvent être citées
const fichiersVus = new Set<string>(); // sur fichiers : ceux qui ont été lus, ou où une ligne a été trouvée
const debut = performance.now();
try {
  for await (const etape of agir(question, agent, { date: values.date, matricule: values.matricule, profil })) {
    if (etape.type === "appel") {
      // tour 0 : la recherche d'office ; « Secours » : celle du code quand le LLM n'a rien appelé
      const quand = etape.tour === 0 ? "D'office" : etape.appel.id === "recherche-de-secours" ? `Tour ${etape.tour}, secours` : `Tour ${etape.tour}`;
      console.log(`${quand} : ${etape.appel.nom}(${JSON.stringify(etape.appel.arguments)})`);
    } else if (etape.type === "resultat") {
      vus.push(...(etape.resultat.passages ?? []));
      for (const m of etape.resultat.texte.matchAll(/^([A-Z0-9-]+)\.md(?:, lignes|:\d+:)/gm)) fichiersVus.add(m[1]);
      const statut = etape.statut === "refusé" || etape.statut === "limite" ? `${etape.statut.toUpperCase()} : ` : "";
      console.log(`         → ${statut}${resume(etape.resultat, etape.erreur && !statut)} en ${secondes(etape.duree)} s`);
      if (etape.detail) console.log(`           (cause, gardée hors du prompt : ${pourLeTerminal(etape.detail)})`);
    } else if (etape.type === "limite") {
      const raison = etape.raison === "tokens" ? "budget de tokens atteint" : `--tours ${toursMax}`;
      console.log(`Tour ${etape.tour} : dernier tour, sans outil (${raison})`);
    } else {
      console.log(`Tour ${etape.tour} : réponse, en ${secondes(performance.now() - debut)} s au total\n\n${etape.texte.trim()}`);
      if (surFichiers) {
        const { cites, inventes } = fichiersCites(etape.texte, fichiersVus);
        console.log(`\nFichiers cités :${cites.length + inventes.length === 0 ? " aucun" : ""}`);
        for (const id of cites) console.log(`  [${id}.md]`);
        for (const id of inventes) console.log(`  [${id}.md]  INTROUVABLE : ni lu, ni trouvé par chercher_texte`);
      } else {
        const { citees, inventees } = sourcesCitees(etape.texte, vus);
        console.log(`\nSources citées :${citees.length + inventees.length === 0 ? " aucune" : ""}`);
        for (const p of citees) console.log(`  [${p.id}]  ${p.titres.join(" > ")}`);
        for (const id of inventees) console.log(`  [${id}]  INTROUVABLE : aucun outil n'a rendu ce passage`);
      }
      console.log(`\nTokens : ${etape.usage.entree} en entrée, dont ${etape.usage.enCache} relus dans le cache ; ${etape.usage.sortie} en sortie`);
    }
  }
} finally {
  await pool.end();
}
