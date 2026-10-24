// L'interface d'inspection de Rhéa (chapitre 14). npm run web la sert en développement sur http://localhost:5173 et
// transmet au serveur de Rhéa (npm run serveur, port 3000) ce qui lui revient : /ask, /api, /retours et /sante ;
// npm run web:construire l'écrit dans web/dist, que le serveur sert lui-même
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const SERVEUR = "http://127.0.0.1:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/ask": SERVEUR, "/api": SERVEUR, "/retours": SERVEUR, "/sante": SERVEUR },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2023",
  },
});
