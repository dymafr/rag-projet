// Le thème : clair, sombre, ou celui du système. Retenu dans le navigateur ; web/public/theme.js le pose avant le premier
// affichage, ce module le change ensuite
import { useCallback, useState } from "react";
import { ecrireStockage, lireStockage } from "../outils/stockage.ts";

export type Theme = "clair" | "sombre" | "systeme";
const CLE = "rhea.theme";

function lireTheme(): Theme {
  const t = lireStockage(CLE);
  return t === "clair" || t === "sombre" ? t : "systeme";
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(lireTheme);
  const choisir = useCallback((t: Theme) => {
    setTheme(t);
    ecrireStockage(CLE, t === "systeme" ? null : t);
    if (t === "systeme") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  }, []);
  return [theme, choisir];
}
