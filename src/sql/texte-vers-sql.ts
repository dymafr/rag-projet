// Traduire une question en SQL (text-to-SQL) : le LLM reçoit la description de la vue soldes_visibles (colonnes, sens,
// unités), quelques exemples et la question ; il rend une requête. On la valide (valider.ts), puis on l'exécute avec les
// droits du salarié (acces.ts). Si la validation ou la base la refuse, le LLM a une seconde chance avec la raison du
// refus : la réparation, que pratiquent aussi les meilleurs systèmes des classements de text-to-SQL
import type { Llm, Usage } from "../llm.ts";
import { executerEnLecture, VUE, type ResultatSql } from "./acces.ts";
import { validerSql } from "./valider.ts";

// Le début du prompt ne change pas d'une question à l'autre : il peut être mis en cache
export const CONSIGNES_SQL = `Tu écris une requête PostgreSQL qui répond à une question sur les soldes de congés des salariés de Kalyo.

Vue ${VUE}, une ligne par salarié :
- matricule (texte, par exemple K0042), prenom, nom
- site : 'lyon' ou 'nantes', en minuscules ; service (par exemple 'Développement', 'Projets clients') ; poste
- manager : le matricule du manager direct (NULL pour la direction)
- temps_travail : pourcentage d'un temps plein ; forfait_jours : booléen (seuls les salariés au forfait jours ont des RTT)
- cp_reliquat : congés payés acquis du 1er juin 2025 au 31 mai 2026, en jours ; cp_en_cours : en cours d'acquisition depuis le 1er juin 2026
- rtt_acquis, rtt_pris, rtt_restants : RTT de l'année civile, en jours
- maj_le : la date de mise à jour des soldes

Règles :
- Une seule requête SELECT, sur la seule vue ${VUE} : aucune autre table, aucune modification.
- N'ajoute aucun filtre pour limiter aux lignes du salarié connecté : la base ne montre déjà que celles qu'il a le droit de voir.
- « moi », « mon solde » : matricule = le matricule du salarié connecté. « mon équipe » : manager = son matricule.
- Compare les noms et les services sans tenir compte de la casse (ILIKE). Arrondis une moyenne avec round(…, 1).
- Réponds uniquement par la requête, dans un bloc \`\`\`sql.

Exemples :
Question : Combien de salariés de Lyon sont à temps partiel ?
\`\`\`sql
SELECT count(*) AS salaries FROM ${VUE} WHERE site = 'lyon' AND temps_travail < 100;
\`\`\`
Question : Quel service a le plus de RTT restants en moyenne ?
\`\`\`sql
SELECT service, round(avg(rtt_restants), 1) AS moyenne FROM ${VUE} WHERE forfait_jours GROUP BY service ORDER BY moyenne DESC LIMIT 1;
\`\`\``;

// La requête dans un bloc ```sql, ou, à défaut, tout le texte
export function extraireSql(texte: string): string {
  const bloc = texte.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  return (bloc ? bloc[1] : texte).trim();
}

export type Interrogation = { sql: string; resultat: ResultatSql | null; erreur: string | null; essais: number; usage: Usage };
type Pool = Parameters<typeof executerEnLecture>[0];

export async function interroger(llm: Llm, pool: Pool, question: string, matricule: string, essaisMax = 2): Promise<Interrogation> {
  const usage: Usage = { entree: 0, enCache: 0, sortie: 0 };
  let sql = "";
  let erreur: string | null = null;
  for (let essai = 1; essai <= essaisMax; essai++) {
    const reparation = erreur ? `\n\nTa requête précédente :\n${sql}\nElle a été refusée : ${erreur}\nCorrige-la.` : "";
    const reponse = await llm(CONSIGNES_SQL, `Salarié connecté : ${matricule}\nQuestion : ${question}${reparation}`);
    usage.entree += reponse.usage.entree;
    usage.enCache += reponse.usage.enCache;
    usage.sortie += reponse.usage.sortie;
    sql = extraireSql(reponse.texte);
    const validation = await validerSql(sql);
    if (!validation.ok) {
      erreur = `validation : ${validation.raison}`;
      continue;
    }
    try {
      return { sql, resultat: await executerEnLecture(pool, sql, matricule), erreur: null, essais: essai, usage };
    } catch (e) {
      erreur = `PostgreSQL : ${(e as Error).message}`;
    }
  }
  return { sql, resultat: null, erreur, essais: essaisMax, usage };
}

// Les lignes en texte, pour le LLM et pour le terminal : « colonne : valeur » si une seule ligne, un tableau sinon
export function enTexte({ colonnes, lignes, tronque }: ResultatSql): string {
  if (lignes.length === 0) return "Aucune ligne.";
  const valeur = (v: unknown) => (v === null ? "NULL" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
  if (lignes.length === 1) return colonnes.map((c) => `${c} : ${valeur(lignes[0][c])}`).join("\n");
  const texte = [colonnes.join(" | "), ...lignes.map((l) => colonnes.map((c) => valeur(l[c])).join(" | "))].join("\n");
  return tronque ? `${texte}\n(résultat tronqué : seules les premières lignes sont montrées)` : texte;
}
