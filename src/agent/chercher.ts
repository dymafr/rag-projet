// L'outil de recherche : la recherche de Rhéa (chapitres 6 à 9), que le LLM appelle quand il en a besoin, avec la
// requête qu'il a choisie. Les passages sont balisés comme au chapitre 7, et se citent par leur source : l'agent peut
// chercher plusieurs fois, des numéros se répéteraient d'une recherche à l'autre
import { z } from "zod";
import { horsCorpus, meilleurScore, SEUIL } from "../generation/abstention.ts";
import { baliser, BUDGET_PASSAGES, choisir, estimerTokens, estUnTicket } from "../generation/prompt.ts";
import type { Profil } from "../recherche/droits.ts";
import type { Resultat } from "../recherche/vectorielle.ts";
import { definirOutil } from "./outil.ts";

export type Chercher = (requete: string, date: string, profil: Profil) => Promise<Resultat[]>;

export const chercherDocuments = (chercher: Chercher) =>
  definirOutil({
    nom: "chercher_documents",
    description:
      "Cherche dans la documentation RH de Kalyo (politiques, accords, FAQ, intranet) les passages utiles à une question " +
      "sur les règles RH (congés, télétravail, notes de frais, paie, mutuelle, formation, astreintes) ou sur la vie pratique " +
      "des sites de Lyon et de Nantes (horaires, accès, stationnement, contacts). Renvoie des passages " +
      "balisés, à citer par leur source entre crochets. Pour comparer deux cas (deux sites, deux périodes), cherchez chacun " +
      "séparément ; si les passages ne répondent pas, cherchez une autre fois avec d'autres mots.",
    parametres: z.object({
      // Une question entière plutôt que des mots-clés : le modèle d'embedding compare des phrases (essai du 13 octobre :
      // « ancienneté télétravail Kalyo » manque l'article sur l'éligibilité, que la question entière trouve en premier)
      requete: z
        .string()
        .trim()
        .min(3)
        .max(300)
        .describe("Une question complète en français, comme le salarié la poserait, et non une liste de mots-clés"),
    }),
    async executer({ requete }, contexte) {
      // Le profil vient du contexte, jamais des arguments : le LLM choisit quoi chercher, pas où il a le droit de chercher
      const resultats = await chercher(requete, contexte.date, contexte.profil);
      // Le seuil d'abstention du chapitre 7 : loin de tout passage, mieux vaut le dire au LLM que lui donner du hors sujet
      if (horsCorpus(resultats)) {
        const meilleur = meilleurScore(resultats).toFixed(3);
        const texte = `Aucun passage assez proche de « ${requete} » (meilleur score ${meilleur}, sous le seuil de ${SEUIL}). La documentation ne traite peut-être pas cette question : cherchez autrement, ou dites-le au salarié.`;
        return { texte, passages: [] };
      }
      // Le budget du chapitre 7, à chaque recherche : les passages les plus proches, tant qu'ils tiennent
      const { passages } = choisir(resultats, BUDGET_PASSAGES, estimerTokens);
      // Chapitre 13 : un ticket est un texte écrit par un salarié ; la boucle de l'agent en tient compte (règle de deux)
      return { texte: passages.map((p) => baliser(p)).join("\n\n"), passages, nonFiable: passages.some(estUnTicket) };
    },
  });
