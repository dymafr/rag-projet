// Un fichier Markdown est déjà au format visé : on sépare seulement son en-tête YAML du texte
export function separerEntete(fichier: string): { entete: string; texte: string } {
  const contenu = fichier.replace(/^\ufeff/, "").replace(/\r\n/g, "\n"); // marque BOM et fins de ligne Windows
  // L'en-tête, s'il existe, est entre deux lignes « --- », tout en haut du fichier
  const m = contenu.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return { entete: "", texte: contenu.trim() };
  return { entete: m[1], texte: contenu.slice(m[0].length).trim() };
}
