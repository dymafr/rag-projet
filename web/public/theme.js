// Le thème choisi dans l'interface (clair, sombre ou système), posé sur <html> avant le premier affichage. Un fichier à
// part, et non un script en ligne : la politique de sécurité du serveur n'exécute que ses propres fichiers
try {
  const theme = localStorage.getItem("rhea.theme");
  if (theme === "clair" || theme === "sombre") document.documentElement.dataset.theme = theme;
} catch {
  // stockage indisponible (navigation privée stricte) : le thème du système
}
