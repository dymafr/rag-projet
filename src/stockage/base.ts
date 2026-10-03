// Ce que le stockage attend d'une base : exécuter une requête SQL avec ses paramètres, et rendre les lignes.
// Le pool de src/db.ts a cette forme. PGlite, un PostgreSQL qui tourne dans Node, aussi : de quoi tester le stockage sans Docker
export interface Base {
  query<Ligne extends object = Record<string, unknown>>(sql: string, parametres?: unknown[]): Promise<{ rows: Ligne[] }>;
}
