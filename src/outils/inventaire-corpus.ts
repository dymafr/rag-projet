// Inventaire de la base documentaire : les formats de chaque dossier, les documents réservés, les données structurées.
// Lancement : npm run corpus
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const RACINE = "corpus";

// 1. Chaque dossier : ses fichiers regroupés par extension, et sa taille
for (const dossier of readdirSync(RACINE).filter((nom) => statSync(join(RACINE, nom)).isDirectory())) {
  const fichiers = readdirSync(join(RACINE, dossier));
  const parExtension = Object.groupBy(fichiers, (fichier) => extname(fichier));
  const detail = Object.entries(parExtension).map(([extension, liste = []]) => `${liste.length} ${extension}`);
  const octets = fichiers.reduce((total, fichier) => total + statSync(join(RACINE, dossier, fichier)).size, 0);
  console.log(`${dossier.padEnd(11)} ${detail.join(", ").padEnd(20)} ${Math.round(octets / 1024)} Ko`);
}

// 2. Les documents réservés aux managers, repérés par leur métadonnée « acces »
const reserves = readdirSync(RACINE, { recursive: true, encoding: "utf8" })
  .filter((chemin) => chemin.endsWith(".yaml"))
  .filter((chemin) => /^acces: manager$/m.test(readFileSync(join(RACINE, chemin), "utf8")));
console.log(`\nRéservés aux managers : ${reserves.join(", ")}`);

// 3. Les données structurées : les tickets RH et la table des salariés
const tickets: unknown[] = JSON.parse(readFileSync(join(RACINE, "tickets", "tickets.json"), "utf8"));
const salaries = readFileSync(join(RACINE, "soldes", "soldes.sql"), "utf8").match(/^ {2}\('K\d{4}', '/gm) ?? [];
console.log(`Tickets RH : ${tickets.length}. Salariés fictifs, avec leurs soldes de congés : ${salaries.length}`);
