// Le point d'entrée de l'interface d'inspection
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Racine } from "./App.tsx";
import "./styles/jetons.css";
import "./styles/base.css";
import "./styles/composants.css";
import "./styles/coquille.css";
import "./styles/pipeline.css";
import "./styles/vues.css";
import "./styles/pages.css";
import "./styles/production.css";

const racine = document.getElementById("racine");
if (!racine) throw new Error("élément #racine absent de index.html");
createRoot(racine).render(
  <StrictMode>
    <Racine />
  </StrictMode>,
);
