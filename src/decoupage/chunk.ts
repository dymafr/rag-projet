// Le chunk : un passage d'un document, assez court pour être vectorisé, et qui sait d'où il vient
export type Chunk = {
  id: string; // l'identifiant du document, puis le rang du chunk : POL-NF-01#4
  document: string; // l'identifiant du document, celui que Rhéa citera
  titres: string[]; // le chemin de titres de sa section, du titre du document jusqu'au plus proche
  texte: string; // en Markdown
  taille: number; // mesurée comme le modèle d'embedding la mesure, en tokens
  contexte?: string; // une ou deux phrases qui situent le chunk dans son document, rédigées par un LLM
};
