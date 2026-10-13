// L'outil de recherche : la recherche de Rhéa (chapitres 6 à 9), que le LLM appelle quand il en a besoin, avec la
// requête qu'il a choisie. Les passages sont balisés comme au chapitre 7, et se citent par leur source : l'agent peut
// chercher plusieurs fois, des numéros se répéteraient d'une recherche à l'autre
import { z } from "zod";
import { horsCorpus, meilleurScore, SEUIL } from "../generation/abstention.ts";
import { baliser, BUDGET_PASSAGES, choisir, estimerTokens } from "../generation/prompt.ts";
import type { Resultat } from "../recherche/vectorielle.ts";
import { definirOutil } from "./outil.ts";

export type Chercher = (requete: string, date: string) => Promise<Resultat[]>;

export const chercherDocuments = (chercher: Chercher) =>
  definirOutil({
    nom: "chercher_documents",
    description:
      "Cherche dans la documentation RH de Kalyo (politiques, accords, FAQ, intranet) les passages utiles à une question " +
      "sur les règles RH (congés, télétravail, notes de frais, paie, mutuelle, formation, astreintes) ou sur la vie pratique " +
      "des sites de Lyon et de Nantes (horaires, accès, stationnement, contacts). Renvoie des passages " +
      "balisés, à citer par leur source entre crochets. Pour comparer deux cas (deux sites, deux périodes), cherchez chacun séparément.",
    parametres: z.object({
      requete: z.string().trim().min(3).max(300).describe("Ce que vous cherchez, en français : une question ou des mots-clés"),
    }),
    async executer({ requete }, contexte) {
      const resultats = await chercher(requete, contexte.date);
      // Le seuil d'abstention du chapitre 7 : loin de tout passage, mieux vaut le dire au LLM que lui donner du hors sujet
      if (horsCorpus(resultats)) {
        const meilleur = meilleurScore(resultats).toFixed(3);
        const texte = `Aucun passage assez proche de « ${requete} » (meilleur score ${meilleur}, sous le seuil de ${SEUIL}). La documentation ne traite peut-être pas cette question : cherchez autrement, ou dites-le au salarié.`;
        return { texte, passages: [] };
      }
      // Le budget du chapitre 7, à chaque recherche : les passages les plus proches, tant qu'ils tiennent
      const { passages } = choisir(resultats, BUDGET_PASSAGES, estimerTokens);
      return { texte: passages.map((p) => baliser(p)).join("\n\n"), passages };
    },
  });
