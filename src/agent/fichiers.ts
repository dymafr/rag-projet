// Chercher sans vecteurs (leçon 7) : les outils d'un agent de code, sur le texte des documents de Kalyo rangé en fichiers
// (npm run textes). Lister les fichiers, y chercher un mot ou une expression comme grep, lire quelques lignes. Ni
// embedding, ni index : le LLM choisit les mots à chercher et ce qu'il lit
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { definirOutil } from "./outil.ts";

export const DOSSIER_TEXTES = "donnees/textes"; // écrit par npm run textes
const LIGNES_MAX = 60; // ce qu'un appel de lire_fichier rend au plus
const RESULTATS_MAX = 25; // les lignes trouvées par chercher_texte, au plus

// Sans accents ni majuscules : « Pentecôte » se trouve en cherchant « pentecote »
const normaliser = (texte: string) => texte.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export function outilsFichiers(dossier: string) {
  // Seuls les fichiers du dossier se lisent : un nom venu du LLM (« ../../.env ») n'ouvre jamais rien d'autre
  const fichiers = async () => (await readdir(dossier)).filter((f) => f.endsWith(".md")).sort();
  const lire = async (fichier: string) => (await readFile(join(dossier, fichier), "utf8")).replace(/\n$/, "").split("\n");

  const lister = definirOutil({
    nom: "lister_fichiers",
    description: "Liste les fichiers de la documentation RH de Kalyo (un par document), avec la première ligne de chacun.",
    parametres: z.object({}),
    async executer() {
      const liste = await fichiers();
      const lignes = await Promise.all(liste.map(async (f) => `${f}  ${(await lire(f))[0]}`));
      return { texte: lignes.join("\n") };
    },
  });

  const chercher = definirOutil({
    nom: "chercher_texte",
    description:
      "Cherche des mots dans tous les fichiers, comme grep, sans tenir compte des accents ni des majuscules : une ligne est " +
      "trouvée si elle contient tous les mots. Renvoie les lignes, avec le fichier et le numéro de ligne. Un ou deux mots " +
      "suffisent ; si rien ne sort, essayez d'autres mots.",
    parametres: z.object({ motif: z.string().trim().min(2).max(80).describe("Un ou deux mots à chercher, par exemple « pentecote » ou « repas client »") }),
    async executer({ motif }) {
      // Chaque mot doit figurer dans la ligne, dans n'importe quel ordre : « jours teletravail » trouve
      // « télétravailler jusqu'à trois jours ». Un mot est cherché tel quel, comme une partie de mot
      const mots = normaliser(motif).split(/\s+/);
      const trouvees: string[] = [];
      for (const f of await fichiers()) {
        (await lire(f)).forEach((ligne, i) => {
          const texte = normaliser(ligne);
          if (mots.every((mot) => texte.includes(mot))) trouvees.push(`${f}:${i + 1}: ${ligne.trim().slice(0, 200)}`);
        });
      }
      if (trouvees.length === 0) return { texte: `Aucune ligne ne contient « ${motif} ».` };
      const reste = trouvees.length > RESULTATS_MAX ? `\n… et ${trouvees.length - RESULTATS_MAX} lignes de plus : précisez le motif.` : "";
      return { texte: trouvees.slice(0, RESULTATS_MAX).join("\n") + reste };
    },
  });

  const lireFichier = definirOutil({
    nom: "lire_fichier",
    description: `Lit des lignes d'un fichier, numérotées (${LIGNES_MAX} au plus par appel). Citez ensuite le fichier entre crochets : [FAQ-RH.md].`,
    parametres: z.object({
      fichier: z.string().describe("Le nom du fichier, tel que le donnent lister_fichiers ou chercher_texte, par exemple FAQ-RH.md"),
      debut: z.number().int().min(1).describe("La première ligne à lire"),
      fin: z.number().int().min(1).describe("La dernière ligne à lire"),
    }).refine((a) => a.fin >= a.debut, { message: "fin doit être au moins égale à debut", path: ["fin"] }),
    async executer({ fichier, debut, fin }) {
      if (!(await fichiers()).includes(fichier)) return { texte: `Fichier inconnu : ${fichier}. Utilisez lister_fichiers.` };
      const lignes = await lire(fichier);
      const derniere = Math.min(fin, debut + LIGNES_MAX - 1, lignes.length);
      if (debut > lignes.length) return { texte: `${fichier} n'a que ${lignes.length} lignes.` };
      const extrait = lignes.slice(debut - 1, derniere).map((l, i) => `${debut + i}: ${l}`);
      return { texte: `${fichier}, lignes ${debut} à ${derniere} sur ${lignes.length} :\n${extrait.join("\n")}` };
    },
  });

  return [lister, chercher, lireFichier];
}
