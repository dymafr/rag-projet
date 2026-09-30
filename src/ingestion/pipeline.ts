// Le pipeline d'ingestion : tout le corpus, chargé, validé et dédoublonné, écrit dans un seul fichier
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { charger, listerFichiers } from "./chargeurs.ts";
import { dedoublonner, empreinte, type Document } from "./document.ts";
import { lierVersions } from "./metadonnees.ts";

export type Bilan = {
  documents: Document[];
  erreurs: { fichier: string; message: string }[];
  doublons: string[];
  nouveaux: string[];
  modifies: string[];
  supprimes: string[];
};

type Options = { racine?: string; sortie?: string; journal?: string };

export async function ingerer({ racine = "corpus", sortie = "donnees/documents.jsonl", journal = "donnees/ingestion.log" }: Options = {}): Promise<Bilan> {
  // 1. Charger chaque fichier. Une erreur est notée, et on passe au fichier suivant
  const charges: Document[] = [];
  const erreurs: Bilan["erreurs"] = [];
  for (const fichier of await listerFichiers(racine)) {
    try {
      charges.push(...(await charger(fichier)));
    } catch (erreur) {
      const message = (erreur as Error).message; // le message d'une bibliothèque ne nomme pas toujours le fichier
      erreurs.push({ fichier, message: message.startsWith(fichier) ? message : `${fichier} : ${message}` });
    }
  }

  // 2. Dédoublonner. Deux textes différents ne peuvent pas porter le même identifiant : c'est lui que Rhéa cite
  const { uniques, doublons } = dedoublonner(charges);
  const documents: Document[] = [];
  for (const document of uniques) {
    const autre = documents.find((d) => d.id === document.id);
    if (autre) erreurs.push({ fichier: document.source, message: `${document.source} : identifiant ${document.id} déjà pris par ${autre.source}` });
    else documents.push(document);
  }
  // Lier les versions, trier : la sortie ne dépend pas de l'ordre de lecture
  lierVersions(documents);
  documents.sort((a, b) => (a.id < b.id ? -1 : 1)); // par codes de caractères : le même ordre sur toutes les machines

  // 3. Comparer avec l'exécution précédente : l'empreinte de chaque document, texte et métadonnées
  const avant = await empreintesPrecedentes(sortie);
  const apres = new Map(documents.map((d) => [d.id, empreinte(JSON.stringify(d))]));
  const nouveaux = [...apres.keys()].filter((id) => !avant.has(id));
  const modifies = [...apres.keys()].filter((id) => avant.has(id) && avant.get(id) !== apres.get(id));
  const supprimes = [...avant.keys()].filter((id) => !apres.has(id));

  // 4. Écrire tout le fichier, un document par ligne. On écrit d'abord un fichier temporaire, puis on le renomme :
  // si le programme s'arrête en route, l'ancien fichier reste intact
  await mkdir(dirname(sortie), { recursive: true });
  await writeFile(`${sortie}.tmp`, documents.map((d) => `${JSON.stringify(d)}\n`).join(""));
  await rename(`${sortie}.tmp`, sortie);

  // 5. Journaliser l'exécution et ses erreurs
  const date = new Date().toISOString();
  const comptes = `nouveaux ${nouveaux.length}, modifiés ${modifies.length}, supprimés ${supprimes.length}`;
  const lignes = [
    `${date} documents ${documents.length}, ${comptes}, doublons ${doublons.length}, erreurs ${erreurs.length}`,
    ...erreurs.map((e) => `${date} ERREUR ${e.message.replaceAll("\n", " ")}`),
  ];
  await mkdir(dirname(journal), { recursive: true });
  await appendFile(journal, lignes.join("\n") + "\n");

  return { documents, erreurs, doublons: doublons.map((d) => d.doublon.source), nouveaux, modifies, supprimes };
}

// L'empreinte de chaque document du fichier précédent, s'il existe
async function empreintesPrecedentes(sortie: string): Promise<Map<string, string>> {
  try {
    const lignes = (await readFile(sortie, "utf8")).split("\n").filter(Boolean);
    return new Map(lignes.map((ligne) => [(JSON.parse(ligne) as Document).id, empreinte(ligne)]));
  } catch {
    return new Map(); // première exécution
  }
}
