// Lancer Rhéa comme serveur MCP sur l'entrée et la sortie standard (stdio) : un client MCP lance cette commande et lui
// parle en JSON-RPC, une ligne par message. La sortie standard appartient au protocole : un texte écrit là est au mieux
// ignoré, au pire il fait perdre une réponse. Les messages de Rhéa partent donc sur la sortie d'erreur
// Lancement (par le client, depuis la racine du projet) : node --env-file=.env src/outils/serveur-mcp.ts
// Pas npm run : npm écrit ses propres lignes sur la sortie standard avant de lancer le script
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { chercherDocuments } from "../agent/chercher.ts";
import { calculerIndemniteKm } from "../agent/outils-rh.ts";
import { pool } from "../db.ts";
import { PASSAGES_DEMANDES } from "../generation/prompt.ts";
import { creerServeurMcp } from "../mcp/serveur.ts";
import { aujourdhui, trouverPassages } from "../recherche/passages.ts";

// Une bibliothèque qui écrirait avec console.log (un avertissement, une barre de progression) casserait le protocole
console.log = console.error;

// Les outils de lecture qui ne dépendent d'aucun salarié : la recherche, le calcul d'indemnité. Le solde et le profil
// demanderaient de savoir qui est au bout ; le ticket, son accord (leçon 5)
const outils = [chercherDocuments((requete, date, profil) => trouverPassages(pool, requete, PASSAGES_DEMANDES, profil, date)), calculerIndemniteKm()];

// serveStdio sert les deux générations du protocole : celle de 2025 (une poignée de main initialize) et celle de 2026.
// Le client ne dit pas qui l'utilise : le profil le plus restreint, les documents ouverts à tous (chapitre 13)
serveStdio(() => creerServeurMcp(outils, () => ({ date: aujourdhui(), profil: "salarie" })), {
  onerror: (erreur) => console.error("Serveur MCP :", erreur),
});
console.error("Rhéa écoute en MCP sur stdio (outils : chercher_documents, calculer_indemnite_km)");
