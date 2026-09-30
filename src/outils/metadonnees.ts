// Les métadonnées de tout le corpus : ce qu'on sait de chaque document, en plus de son texte
// Lancement : npm run metadonnees -- POL-TT-01
import { charger, listerFichiers } from "../ingestion/chargeurs.ts";
import { lierVersions } from "../ingestion/metadonnees.ts";

const documents = (await Promise.all((await listerFichiers()).map(charger))).flat();
lierVersions(documents);

// 1. Les documents selon trois métadonnées : leur type, qui peut les lire, leur langue
for (const champ of ["type", "acces", "langue"] as const) {
  const groupes = Object.groupBy(documents, (d) => d.metadonnees[champ]);
  const detail = Object.entries(groupes).map(([valeur, liste = []]) => `${valeur} ${liste.length}`);
  console.log(`${champ.padEnd(7)} ${detail.join(", ")}`);
}

// 2. Ce qui demandera un traitement particulier
const avec = (filtre: (d: (typeof documents)[number]) => boolean) => documents.filter(filtre).map((d) => d.id).join(", ");
console.log(`\nRéservés aux managers : ${avec((d) => d.metadonnees.acces === "manager")}`);
console.log(`En anglais : ${avec((d) => d.metadonnees.langue === "en")}`);
console.log(`Remplacés par une version plus récente : ${avec((d) => !!d.metadonnees.remplace_par)}`);

// 3. Les métadonnées d'un document
const exemple = documents.find((d) => d.id === (process.argv[2] ?? "POL-TT-01"));
if (exemple) console.log(`\n${exemple.id} (${exemple.source})\n${JSON.stringify(exemple.metadonnees, null, 2)}`);
