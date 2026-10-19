// Le journal de l'agent : une ligne JSON par appel d'outil, dans journal/agent-AAAA-MM-JJ.jsonl. On y retrouve, après
// coup, ce que l'agent a fait, pour qui, et ce que ça a donné. Chapitre 13, leçon 4 : un journal est une copie de plus,
// souvent moins bien protégée que la base. Il ne garde donc que des références, jamais les données elles-mêmes :
// - le salarié par un pseudonyme (un HMAC du matricule), pas son matricule ; la clé est rangée ailleurs que le journal ;
// - le nom des arguments que l'outil déclare, pas leur valeur (une requête peut nommer un collègue ou une maladie) ;
// - les identifiants des passages rendus, pas leur texte.
// Et il ne vit pas plus longtemps que sa finalité, détecter un abus ou comprendre un incident : au moins six mois (la CNIL
// recommande de six mois à un an). Le dossier reste exclu de Git
import { createHmac, randomBytes } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { EntreeJournal } from "./boucle.ts";

export const RETENTION_JOURS = 184; // au moins six mois, quels que soient les mois : la plus longue période de six mois
export const CLE_DU_JOURNAL = "donnees/journal.cle";

// La clé du pseudonyme : 32 octets aléatoires, créés au premier usage, lisibles par le seul propriétaire du fichier.
// Sans elle, impossible de recalculer le pseudonyme d'un matricule connu ; un simple hachage, lui, se retrouve en
// essayant les 180 matricules. En production, la clé vient d'un gestionnaire de secrets, pas d'un fichier voisin
export async function cleDuJournal(chemin = CLE_DU_JOURNAL): Promise<Buffer> {
  let texte: string;
  try {
    texte = await readFile(chemin, "utf8");
  } catch (erreur) {
    if ((erreur as NodeJS.ErrnoException).code !== "ENOENT") throw erreur; // illisible : on s'arrête, sans rien écraser
    const cle = randomBytes(32);
    await mkdir(dirname(chemin), { recursive: true });
    await writeFile(chemin, cle.toString("hex") + "\n", { mode: 0o600, flag: "wx" }); // wx : ne jamais écraser une clé
    return cle;
  }
  // Un fichier vide ou abîmé donnerait une clé courte, voire vide : un pseudonyme que n'importe qui recalcule
  if (!/^[0-9a-f]{64}$/i.test(texte.trim())) throw new Error(`${chemin} : 64 caractères hexadécimaux attendus (en créer une autre changerait tous les pseudonymes)`);
  return Buffer.from(texte.trim(), "hex");
}

// Le pseudonyme d'un matricule : toujours le même avec la même clé, ce qui permet de suivre un salarié dans le journal
// sans savoir qui il est. Seul celui qui a la clé peut le relier à un matricule
export const pseudonyme = (matricule: string, cle: Buffer) => createHmac("sha256", cle).update(matricule).digest("hex").slice(0, 16);

// Effacer les fichiers du journal plus vieux que la durée de conservation. Les fichiers effacés, du plus ancien au plus récent
export async function purgerJournal(dossier: string, aujourdhui: string, jours = RETENTION_JOURS): Promise<string[]> {
  const limite = new Date(Date.parse(aujourdhui) - jours * 86_400_000).toISOString().slice(0, 10);
  const effaces = (await readdir(dossier).catch(() => [] as string[]))
    .filter((nom) => /^agent-\d{4}-\d{2}-\d{2}\.jsonl$/.test(nom) && nom.slice(6, 16) < limite)
    .sort();
  for (const nom of effaces) await rm(join(dossier, nom));
  return effaces;
}

// Chaque ligne passe par JSON.stringify : un retour à la ligne dans une valeur est échappé, une ligne ne peut pas en
// fabriquer une autre (l'injection de journal)
export function journalJsonl(dossier = "journal", { cle = CLE_DU_JOURNAL, jours = RETENTION_JOURS } = {}) {
  let pret: Promise<Buffer> | undefined;
  return async (entree: EntreeJournal) => {
    // Au premier appel : la purge des fichiers trop anciens, puis la clé
    pret ??= purgerJournal(dossier, entree.horodatage.slice(0, 10), jours).then(() => cleDuJournal(cle));
    const secret = await pret;
    const { horodatage, matricule, ...reste } = entree;
    // Une référence peut porter un matricule (la fiche ORGANIGRAMME-K0006#1 du chapitre 12, essai du 19 octobre) : tout
    // matricule d'un identifiant de passage passe aussi par le pseudonyme (l'outil et les champs : agent/boucle.ts)
    const sansMatricule = (texte: string) => texte.replace(/\bK\d{4}\b/g, (m) => pseudonyme(m, secret));
    const ligne = { horodatage, salarie: matricule ? pseudonyme(matricule, secret) : null, ...reste, passages: reste.passages.map(sansMatricule) };
    await mkdir(dossier, { recursive: true });
    // Un fichier par jour : il se lit, se garde ou s'efface jour par jour
    await appendFile(join(dossier, `agent-${entree.horodatage.slice(0, 10)}.jsonl`), JSON.stringify(ligne) + "\n");
  };
}
