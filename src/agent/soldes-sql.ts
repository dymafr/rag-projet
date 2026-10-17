// L'outil statistique de Rhéa (chapitre 12, leçon 3) : les questions chiffrées sur les soldes (combien, quelle moyenne,
// qui a le plus) passent par une requête SQL, écrite par un LLM et exécutée avec les droits du salarié connecté. Le
// LLM de l'agent ne voit ni la base ni le SQL des autres : il reçoit le périmètre, la requête et son résultat
import { z } from "zod";
import type { Llm } from "../llm.ts";
import { executerEnLecture, perimetre } from "../sql/acces.ts";
import { enTexte, interroger } from "../sql/texte-vers-sql.ts";
import type { Base } from "../stockage/base.ts";
import { definirOutil } from "./outil.ts";

type Pool = Base & Parameters<typeof executerEnLecture>[0];

export const interrogerSoldes = (pool: Pool, llm: Llm) =>
  definirOutil({
    nom: "interroger_soldes",
    description:
      "Répond aux questions chiffrées sur les soldes de congés payés et de RTT : combien de salariés, quelle moyenne, quel " +
      "total, qui a le plus ou le moins. Écrit une requête SQL en lecture seule et l'exécute avec les droits du salarié " +
      "connecté : ses propres soldes, ceux de son équipe s'il est manager, ceux de tous s'il est au service RH. Pour son " +
      "seul solde, consulter_solde suffit.",
    parametres: z.object({
      question: z.string().trim().min(5).max(300).describe("La question chiffrée, en français, telle que le salarié la pose"),
    }),
    async executer({ question }, contexte) {
      if (!contexte.matricule) return { texte: "Aucun salarié n'est connecté : les soldes ne peuvent pas être consultés. Proposez de se connecter à l'espace RH." };
      const portee = await perimetre(pool, contexte.matricule);
      const r = await interroger(llm, pool, question, contexte.matricule);
      if (!r.resultat) return { texte: `La requête n'a pas pu être exécutée (${r.erreur}). Dites au salarié que cette question n'a pas de réponse.` };
      return { texte: `Périmètre : ${portee}.\nRequête : ${r.sql.replace(/\s+/g, " ")}\nRésultat :\n${enTexte(r.resultat)}` };
    },
  });
