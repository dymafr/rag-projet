// L'outil organigramme de Rhéa : qui est le manager de qui, qui travaille dans quelle équipe. Il répond aux questions
// relationnelles (« qui valide mes congés ? », « qui est le manager de mon manager ? ») que la recherche dans les
// documents ne sait pas traiter : la réponse n'est écrite dans aucun passage, elle se lit en suivant des liens.
// La règle (qui valide, sous quel délai) reste dans les documents : le LLM combine les deux outils. La fiche rendue
// est un passage comme les autres, avec sa source au format des autres (ORGANIGRAMME-K0042#1) : le LLM la cite entre
// crochets, et l'on vérifie qu'il cite une fiche réellement lue. Essai du 17 octobre : sans source à citer,
// le modèle local écrivait [consulter_organigramme], le nom de l'outil, malgré la consigne contraire
// du prompt : d'où cette fiche citable
import { z } from "zod";
import { baliser } from "../generation/prompt.ts";
import { chaine, equipe, nomComplet, trouver, type Personne } from "../graphe/organigramme.ts";
import type { Base } from "../stockage/base.ts";
import { definirOutil } from "./outil.ts";

const SITES: Record<string, string> = { lyon: "Lyon", nantes: "Nantes" };
const fiche = (p: Personne) => `${nomComplet(p)} (${p.matricule}), ${p.poste}, service ${p.service}, site de ${SITES[p.site] ?? p.site}`;
// Au-delà, l'équipe est résumée par son effectif : une liste de 20 noms suffit à répondre
const EQUIPE_MAX = 20;

export const consulterOrganigramme = (base: Base) =>
  definirOutil({
    nom: "consulter_organigramme",
    description:
      "Donne la place d'une personne dans l'organigramme de Kalyo : son poste, son manager, la chaîne de ses managers " +
      "jusqu'à la direction, et son équipe (noms et effectif) si elle en a une. Sans paramètre : le salarié qui pose la " +
      "question. À appeler pour toute question sur un manager, un responsable, une équipe, ou pour savoir qui valide une demande ou qui " +
      "contacter : la documentation ne donne le nom d'aucun manager. La règle elle-même (délai, démarche) est dans les " +
      "documents, avec chercher_documents. Renvoie une fiche balisée, à citer par sa source entre crochets.",
    parametres: z.object({
      // Facultatif, donc nullable (le mode strict d'OpenAI exige chaque champ) : null pour le salarié connecté
      personne: z.string().trim().min(2).max(80).nullable().describe("Le nom, le prénom et le nom, ou le matricule (K0042) d'une personne de Kalyo ; null pour le salarié connecté"),
    }),
    async executer({ personne }, contexte) {
      let matricule = contexte.matricule;
      if (personne) {
        const trouvees = await trouver(base, personne);
        // Un rôle (« la référente handicap ») n'est pas un nom : la documentation donne le nom, l'organigramme le reste
        if (trouvees.length === 0) {
          const texte = `Personne ne s'appelle « ${personne} » dans l'organigramme de Kalyo. Cet outil cherche un nom ou un matricule : pour un rôle (une référente, un responsable), cherchez d'abord son nom dans la documentation.`;
          return { texte };
        }
        if (trouvees.length > 1) {
          return { texte: `Plusieurs personnes correspondent à « ${personne} » : ${trouvees.map(fiche).join(" ; ")}. Précisez laquelle.` };
        }
        matricule = trouvees[0].matricule;
      }
      if (!matricule) return { texte: "Aucun salarié n'est connecté : précisez de qui il s'agit (nom ou matricule)." };
      const [lui, ...managers] = await chaine(base, matricule);
      if (!lui) return { texte: `Aucun salarié trouvé pour le matricule ${matricule}.` };
      const { directs, total } = await equipe(base, matricule);
      const qui = personne ? fiche(lui) : `Le salarié connecté : ${fiche(lui)}`;
      const lignes = [
        `${qui}.`,
        managers.length === 0
          ? "- Pas de manager : cette personne fait partie de la direction."
          : `- Manager : ${fiche(managers[0])}.`,
      ];
      if (managers.length > 1) lignes.push(`- Au-dessus : ${managers.slice(1).map(fiche).join(", puis ")}.`);
      if (directs.length > 0) {
        const liste = directs.slice(0, EQUIPE_MAX).map((p) => `${nomComplet(p)} (${p.poste})`).join(", ");
        const suite = directs.length > EQUIPE_MAX ? `, et ${directs.length - EQUIPE_MAX} autres` : "";
        lignes.push(`- Équipe directe (${directs.length} personnes) : ${liste}${suite}.`);
        if (total > directs.length) lignes.push(`- En tout, ${total} personnes dépendent de cette personne, directement ou non.`);
      } else {
        // Chapitre 14, leçon 5 : le dire. Sans cette ligne, le LLM répondait « l'organigramme ne précise pas son équipe »
        lignes.push("- Équipe directe : aucune, personne ne dépend de cette personne.");
      }
      const passage = {
        id: `ORGANIGRAMME-${lui.matricule}#1`,
        document: `ORGANIGRAMME-${lui.matricule}`,
        titres: ["Organigramme de Kalyo", nomComplet(lui)],
        texte: lignes.join("\n"),
        score: 1,
      };
      return { texte: baliser(passage), passages: [passage] };
    },
  });
