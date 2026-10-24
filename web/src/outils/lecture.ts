// Lire sans risque ce que le serveur envoie : le détail d'une étape est un objet JSON libre (Record<string, unknown>).
// Chaque rendu vérifie le type de chaque champ avant de l'afficher ; un champ absent ou inattendu donne undefined, et le
// rendu se replie sur l'arbre JSON

export type Objet = Record<string, unknown>;

export const estObjet = (v: unknown): v is Objet => typeof v === "object" && v !== null && !Array.isArray(v);
export const texte = (o: Objet | undefined, cle: string): string | undefined => (typeof o?.[cle] === "string" ? (o[cle] as string) : undefined);
export const nombre = (o: Objet | undefined, cle: string): number | undefined =>
  typeof o?.[cle] === "number" && Number.isFinite(o[cle]) ? (o[cle] as number) : undefined;
export const booleen = (o: Objet | undefined, cle: string): boolean | undefined => (typeof o?.[cle] === "boolean" ? (o[cle] as boolean) : undefined);
export const liste = (o: Objet | undefined, cle: string): unknown[] => (Array.isArray(o?.[cle]) ? (o[cle] as unknown[]) : []);
export const objet = (o: Objet | undefined, cle: string): Objet | undefined => (estObjet(o?.[cle]) ? (o[cle] as Objet) : undefined);
export const textes = (o: Objet | undefined, cle: string): string[] => liste(o, cle).filter((v): v is string => typeof v === "string");

// Un passage dans une trace (enBref, trace.ts) : identifiant, document, titre, score
export type PassageBref = { id: string; document: string; titre: string; score: number };
export function passageBref(v: unknown): PassageBref | null {
  if (!estObjet(v)) return null;
  const id = texte(v, "id");
  if (!id) return null;
  return { id, document: texte(v, "document") ?? id.split("#")[0], titre: texte(v, "titre") ?? "", score: nombre(v, "score") ?? 0 };
}
export const passagesBrefs = (o: Objet | undefined, cle: string): PassageBref[] =>
  liste(o, cle).flatMap((v) => {
    const p = passageBref(v);
    return p ? [p] : [];
  });

// L'identifiant d'un passage : DOCUMENT#numéro (POL-TT-02#3, FAQ-RH#2, ORGANIGRAMME-K0101#1)
export const MOTIF_PASSAGE = /^[A-Z0-9][A-Z0-9-]{1,39}#\d{1,4}$/;
export const estIdPassage = (v: string) => MOTIF_PASSAGE.test(v);
// Les identifiants dans un texte libre (un résultat d'outil, un message)
export const MOTIF_PASSAGES_DANS_TEXTE = /\b[A-Z0-9][A-Z0-9-]{1,39}#\d{1,4}\b/g;
