// Faire défiler jusqu'à un élément, dans son seul conteneur qui défile. scrollIntoView déplacerait aussi les ancêtres
// (même ceux en overflow: hidden), et la barre du haut sortirait de l'écran
export function defilerJusqua(element: HTMLElement, options: { marge?: number; doux?: boolean; seulementSiCache?: boolean } = {}) {
  const { marge = 16, doux = false, seulementSiCache = false } = options;
  let conteneur = element.parentElement;
  while (conteneur) {
    const style = getComputedStyle(conteneur);
    if (/(auto|scroll)/.test(style.overflowY) && conteneur.scrollHeight > conteneur.clientHeight) break;
    conteneur = conteneur.parentElement;
  }
  if (!conteneur) return;
  const boite = conteneur.getBoundingClientRect();
  const cible = element.getBoundingClientRect();
  if (seulementSiCache) {
    if (cible.top < boite.top) conteneur.scrollTop += cible.top - boite.top;
    else if (cible.bottom > boite.bottom) conteneur.scrollTop += cible.bottom - boite.bottom;
    return;
  }
  const mouvement = window.matchMedia("(prefers-reduced-motion: reduce)").matches || !doux ? "auto" : "smooth";
  conteneur.scrollTo({ top: conteneur.scrollTop + cible.top - boite.top - marge, behavior: mouvement });
}
