// Tests des outils de la recherche sans vecteurs (leçon 7), sur deux fichiers écrits dans un dossier temporaire.
// Ni base, ni LLM. Lancement : npm test
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executer } from "../src/agent/boucle.ts";
import { outilsFichiers } from "../src/agent/fichiers.ts";
import type { Outil } from "../src/agent/outil.ts";
import { fichiersCites } from "../src/agent/sources.ts";

let lister: Outil, chercher: Outil, lire: Outil;
const contexte = { date: "2026-10-13" };
before(async () => {
  const dossier = await mkdtemp(join(tmpdir(), "textes-"));
  await writeFile(join(dossier, "FAQ-RH.md"), "<!-- FAQ-RH · faq -->\n# FAQ RH de Kalyo\n\n## Jours fériés\n\nLe lundi de Pentecôte est travaillé : journée de solidarité.\n");
  await writeFile(join(dossier, "INT-SITE-LYON.md"), "<!-- INT-SITE-LYON · intranet -->\n# Le site de Lyon\n\nBâtiment ouvert de 7 h 30 à 20 h.\n");
  [lister, chercher, lire] = outilsFichiers(dossier);
});

test("lister_fichiers donne chaque fichier avec sa première ligne", async () => {
  const { texte } = await lister.executer({}, contexte);
  assert.equal(texte, "FAQ-RH.md  <!-- FAQ-RH · faq -->\nINT-SITE-LYON.md  <!-- INT-SITE-LYON · intranet -->");
});

test("chercher_texte trouve un mot sans tenir compte des accents ni des majuscules, avec le fichier et la ligne", async () => {
  const { texte } = await chercher.executer({ motif: "PENTECOTE" }, contexte);
  assert.equal(texte, "FAQ-RH.md:6: Le lundi de Pentecôte est travaillé : journée de solidarité.");
  const deux = await chercher.executer({ motif: "solidarite lundi" }, contexte); // tous les mots, dans n'importe quel ordre
  assert.equal(deux.texte, texte);
  const rien = await chercher.executer({ motif: "cantine" }, contexte);
  assert.equal(rien.texte, "Aucune ligne ne contient « cantine ».");
});

test("lire_fichier rend les lignes demandées, numérotées, et rien hors du dossier", async () => {
  const { texte } = await lire.executer({ fichier: "INT-SITE-LYON.md", debut: 2, fin: 4 }, contexte);
  assert.equal(texte, "INT-SITE-LYON.md, lignes 2 à 4 sur 4 :\n2: # Le site de Lyon\n3: \n4: Bâtiment ouvert de 7 h 30 à 20 h.");
  const dehors = await lire.executer({ fichier: "../.env", debut: 1, fin: 5 }, contexte);
  assert.match(dehors.texte, /^Fichier inconnu : \.\.\/\.env/);
});

test("lire_fichier refuse une ligne de début qui n'est pas un entier positif, ou une fin avant le début", async () => {
  const { erreur } = await executer({ id: "l", nom: "lire_fichier", arguments: { fichier: "FAQ-RH.md", debut: 0, fin: 3 } }, [lire], contexte);
  assert.deepEqual([erreur, (await executer({ id: "l", nom: "lire_fichier", arguments: { fichier: "FAQ-RH.md", debut: 5, fin: 2 } }, [lire], contexte)).erreur], [true, true]);
});

test("fichiersCites sépare les fichiers lus ou trouvés de ceux que le LLM cite sans les avoir vus", () => {
  const texte = "Le lundi de Pentecôte est travaillé [FAQ-RH.md]. Il n'est pas payé en plus [POL-Conges-Absences.md].";
  assert.deepEqual(fichiersCites(texte, new Set(["FAQ-RH"])), { cites: ["FAQ-RH"], inventes: ["POL-Conges-Absences"] });
});
