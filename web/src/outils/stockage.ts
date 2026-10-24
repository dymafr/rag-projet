// Le stockage local du navigateur, sans risque : en navigation privée stricte, il lève une exception ; l'interface
// continue alors sans rien retenir
export function lireStockage(cle: string): string | null {
  try {
    return localStorage.getItem(cle);
  } catch {
    return null;
  }
}

export function ecrireStockage(cle: string, valeur: string | null) {
  try {
    if (valeur === null) localStorage.removeItem(cle);
    else localStorage.setItem(cle, valeur);
  } catch {
    // rien à faire : la préférence ne sera pas retenue
  }
}
