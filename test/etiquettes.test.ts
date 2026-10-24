// Tests des étiquettes humaines (chapitre 14, leçon 4) : les désaccords entre deux juges sur les mêmes réponses, les
// décisions gardées dans un fichier, et la fiabilité d'un juge mesurée contre elles. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { desaccords, etiqueter, fiabilite, lireEtiquettes, scoreVerifie } from "../src/eval/etiquettes.ts";
import type { Execution, ResultatQuestion } from "../src/eval/production.ts";
import { empreinte } from "../src/eval/reponses.ts";

// Une exécution réduite à ce que lisent les étiquettes : l'identifiant, le texte de la réponse et le verdict
const resultat = (id: string, texte: string, reussie: boolean | null) =>
  ({ question: { id, question: `question ${id}` }, obtenu: { texte }, verdict: { reussie, criteres: reussie === false ? [{ critere: "exactitude", ok: false, raison: "date fausse" }] : [] } }) as unknown as ResultatQuestion;
const execution = (resultats: ResultatQuestion[]) => ({ jeu: "travail", resultats }) as unknown as Execution;

const juge1 = execution([resultat("Q1", "Trois jours.", true), resultat("Q2", "Le 1er novembre.", false), resultat("Q3", "Non.", true)]);
const juge2 = execution([resultat("Q1", "Trois jours.", true), resultat("Q2", "Le 1er novembre.", true), resultat("Q3", "Autre texte.", false)]);

test("un désaccord : la même réponse, deux verdicts différents ; une réponse différente ne compte pas", () => {
  const liste = desaccords(juge1, juge2);
  assert.deepEqual(liste.map((d) => [d.id, d.a, d.b]), [["Q2", false, true]]);
  assert.equal(liste[0].empreinte, empreinte("Le 1er novembre."));
  assert.deepEqual(liste[0].raisonsA, ["exactitude : date fausse"]);
});

test("une étiquette remplace la précédente pour la même réponse, et mesure chaque juge sur deux taux", async () => {
  const fichier = join(await mkdtemp(join(tmpdir(), "etiquettes-")), "etiquettes.json");
  assert.deepEqual(await lireEtiquettes(fichier), []); // pas encore de fichier
  const decision = { id: "Q2", reponse: empreinte("Le 1er novembre."), date: "2026-10-20" };
  await etiqueter({ ...decision, reussie: false, raison: "première lecture" }, fichier);
  await etiqueter({ ...decision, reussie: true, raison: "la Toussaint est bien le 1er novembre" }, fichier);
  const etiquettes = await lireEtiquettes(fichier);
  assert.equal(etiquettes.length, 1);
  // Q2 est juste : le juge 2 la reconnaît (sensibilité 1), le juge 1 non (0). Aucune fausse étiquetée : spécificité inconnue
  assert.deepEqual([fiabilite(juge1, etiquettes).sensibilite, fiabilite(juge2, etiquettes).sensibilite], [0, 1]);
  assert.equal(fiabilite(juge1, etiquettes).specificite, null);
  // Une étiquette ne vaut que pour le texte jugé : sur une autre réponse à Q2, elle ne compte pas
  assert.equal(fiabilite(execution([resultat("Q2", "Le 2 novembre.", true)]), etiquettes).etiquetees, 0);
  // Le score vérifié : Q1 (deux juges d'accord, réussie), Q2 (étiquetée réussie), Q3 (réponses différentes, à trancher)
  assert.deepEqual(scoreVerifie(juge1, juge2, etiquettes), { reussies: 2, aTrancher: 1, total: 3 });
  assert.deepEqual(scoreVerifie(juge1, juge2, []), { reussies: 1, aTrancher: 2, total: 3 });
});
