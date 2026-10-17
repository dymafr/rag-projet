// Valider une requête écrite par le LLM avant de l'exécuter. On la lit avec le vrai analyseur de PostgreSQL
// (libpg-query : celui du serveur, compilé en WebAssembly), puis on parcourt son arbre : une expression régulière se
// laisse tromper par un commentaire ou une chaîne, l'arbre non. Une requête acceptée a une seule instruction, un SELECT,
// ne lit que la vue soldes_visibles (et ses propres sous-requêtes nommées, WITH) et n'appelle que des fonctions de calcul.
// Tout le reste est refusé avec sa raison : le LLM peut corriger sa requête. Ce n'est qu'une des barrières : le rôle, la
// sécurité par ligne et la transaction en lecture seule (src/sql/acces.ts) tiennent même si celle-ci laisse passer
import { parse } from "libpg-query";
import { VUE } from "./acces.ts";

// Agrégats et fonctions de calcul. Ni set_config (changer de salarié), ni current_setting, ni pg_sleep, ni aucune
// fonction système. coalesce, nullif, greatest et least ne sont pas des appels de fonction pour l'analyseur : ils passent
export const FONCTIONS = new Set(["count", "sum", "avg", "min", "max", "round", "abs", "lower", "upper", "length", "concat", "string_agg"]);

// Une instruction qui modifie, cachée dans une sous-requête nommée : WITH t AS (DELETE FROM soldes RETURNING *) SELECT …
const MODIFICATIONS = new Set(["InsertStmt", "UpdateStmt", "DeleteStmt", "MergeStmt"]);

export type Validation = { ok: true } | { ok: false; raison: string };
const refus = (raison: string): Validation => ({ ok: false, raison });

type Noeud = Record<string, unknown>;

// Parcourt tout l'arbre et appelle visiter pour chaque nœud nommé ({ "RangeVar": {…} } : nom RangeVar)
function parcourir(valeur: unknown, visiter: (nom: string, noeud: Noeud) => void): void {
  if (Array.isArray(valeur)) {
    for (const v of valeur) parcourir(v, visiter);
  } else if (valeur && typeof valeur === "object") {
    for (const [nom, enfant] of Object.entries(valeur)) {
      if (enfant && typeof enfant === "object" && !Array.isArray(enfant)) visiter(nom, enfant as Noeud);
      parcourir(enfant, visiter);
    }
  }
}

const noms = (liste: unknown) => (Array.isArray(liste) ? liste.map((n) => String((n as { String?: { sval?: string } }).String?.sval ?? "")) : []);

// Les tables lues hors de la vue, en respectant la portée des sous-requêtes nommées : sans RECURSIVE, une sous-requête
// ne voit que celles qui la précèdent, pas elle-même. Sinon, WITH salaries AS (SELECT * FROM salaries) lirait la vraie
// table salaries sous un nom de sous-requête (sonde du 17 octobre)
type Avec = { ctes?: { CommonTableExpr?: Noeud }[]; recursive?: boolean };
function tablesLues(valeur: unknown, visibles: ReadonlySet<string>, tables: string[]): void {
  if (Array.isArray(valeur)) {
    for (const v of valeur) tablesLues(v, visibles, tables);
    return;
  }
  if (!valeur || typeof valeur !== "object") return;
  const { withClause, ...reste } = valeur as Noeud & { withClause?: Avec };
  let portee = visibles;
  if (withClause) {
    const ctes = (withClause.ctes ?? []).flatMap((c) => (c.CommonTableExpr ? [c.CommonTableExpr] : []));
    const toutes = new Set([...visibles, ...ctes.map((c) => String(c.ctename))]);
    const precedentes = new Set(visibles);
    for (const cte of ctes) {
      tablesLues(cte.ctequery, withClause.recursive ? toutes : precedentes, tables);
      precedentes.add(String(cte.ctename));
    }
    portee = toutes;
  }
  for (const [nom, enfant] of Object.entries(reste)) {
    if (nom === "RangeVar") {
      const r = enfant as Noeud;
      const table = r.schemaname ? `${r.schemaname}.${r.relname}` : String(r.relname);
      if (table !== VUE && !portee.has(table)) tables.push(table);
    } else tablesLues(enfant, portee, tables);
  }
}

export async function validerSql(sql: string): Promise<Validation> {
  let stmts: { stmt: Noeud }[];
  try {
    stmts = ((await parse(sql)).stmts ?? []) as unknown as { stmt: Noeud }[]; // l'arbre, lu comme du JSON
  } catch (erreur) {
    return refus(`erreur de syntaxe : ${(erreur as Error).message}`);
  }
  if (stmts.length !== 1) return refus(`une seule instruction est permise (reçu : ${stmts.length})`);
  const [type] = Object.keys(stmts[0].stmt);
  if (type !== "SelectStmt") return refus(`seul SELECT est permis (reçu : ${type})`);

  const fonctions: string[] = [];
  const problemes: string[] = [];
  parcourir(stmts[0].stmt, (nom, noeud) => {
    if (nom === "FuncCall") fonctions.push(noms(noeud.funcname).join("."));
    else if (MODIFICATIONS.has(nom)) problemes.push(`modification interdite (${nom})`);
    else if (nom === "SelectStmt" && noeud.intoClause) problemes.push("SELECT INTO interdit");
    else if (nom === "SelectStmt" && noeud.lockingClause) problemes.push("verrou (FOR UPDATE) interdit");
  });
  if (problemes.length > 0) return refus(problemes.join(" ; "));
  const horsVue: string[] = [];
  tablesLues(stmts[0].stmt, new Set(), horsVue);
  if (horsVue.length > 0) return refus(`seule la vue ${VUE} peut être lue (reçu : ${[...new Set(horsVue)].join(", ")})`);
  const interdites = fonctions.filter((f) => !FONCTIONS.has(f.toLowerCase()));
  if (interdites.length > 0) return refus(`fonction non autorisée : ${[...new Set(interdites)].join(", ")}`);
  return { ok: true };
}
