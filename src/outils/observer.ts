// Suivre Rhéa en production (chapitre 14, leçon 7) : les indicateurs des derniers jours, et la dérive des 7 derniers jours
// par rapport aux 28 d'avant. Les mêmes chiffres que la vue Observabilité de l'interface, dans le terminal
// Lancement : npm run observer -- [--jours 30] [--purger] (--purger : efface les observations de plus de six mois)
import { parseArgs } from "node:util";
import { pool } from "../db.ts";
import { creerObservations, derive, parJour, purgerObservations } from "../observabilite/observations.ts";
import { aujourdhui } from "../recherche/passages.ts";

const { values } = parseArgs({ options: { jours: { type: "string", default: "30" }, purger: { type: "boolean", default: false } } });
const jours = Number(values.jours);
if (!Number.isInteger(jours) || jours < 1) throw new Error("--jours attend un nombre entier positif");
await creerObservations(pool);
try {
  if (values.purger) console.log(`${await purgerObservations(pool)} observation(s) de plus de six mois effacée(s)\n`);
  const liste = await parJour(pool, Math.max(jours, 35)); // la dérive compare aux 28 jours d'avant les 7 derniers
  const pct = (n: number, total: number) => (total ? `${Math.round((100 * n) / total)} %` : "-").padStart(5);
  console.log("jour         questions  sans source  dégradées  p50     p95     coût      score  avis + / -");
  // Les jours du calendrier, aujourd'hui compris : un jour sans question n'a pas de ligne, il ne doit pas en faire entrer
  // un plus ancien
  const depuis = new Date(Date.parse(aujourdhui()) - (jours - 1) * 86_400_000).toISOString().slice(0, 10);
  for (const j of liste.filter((l) => l.jour >= depuis)) {
    const secondes = (ms: number | null) => (ms === null ? "-" : `${(ms / 1000).toFixed(1)} s`).padStart(7);
    console.log(
      `${j.jour}   ${String(j.questions).padStart(9)}  ${pct(j.sans_source, j.questions).padStart(11)}  ${pct(j.degradees, j.questions).padStart(9)}  ` +
        `${secondes(j.latence_p50)} ${secondes(j.latence_p95)}  ${(j.cout === null ? "-" : `${j.cout.toFixed(3)} $`).padStart(8)}  ` +
        `${(j.meilleur_score === null ? "-" : j.meilleur_score.toFixed(3)).padStart(5)}  ${j.retours_positifs} / ${j.retours_negatifs}`,
    );
  }
  const { recents, avant, alertes } = derive(liste, aujourdhui());
  const taux = (x: number | null) => (x === null ? "-" : `${(100 * x).toFixed(1)} %`);
  const questions = (n: number) => `${n} question${n > 1 ? "s" : ""}`;
  console.log(`\n7 derniers jours : ${questions(recents.questions)}, ${taux(recents.sansSource)} sans source, meilleur score ${recents.meilleurScore?.toFixed(3) ?? "-"}`);
  console.log(`28 jours d'avant : ${questions(avant.questions)}, ${taux(avant.sansSource)} sans source, meilleur score ${avant.meilleurScore?.toFixed(3) ?? "-"}`);
  console.log(alertes.length ? `Dérive possible : ${alertes.join(" ; ")}. Relisez des questions récentes avec l'inspection.` : "Aucune dérive repérée.");
} finally {
  await pool.end();
}
