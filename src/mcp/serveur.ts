// Rhéa comme serveur MCP : ses outils de lecture, offerts à n'importe quel client MCP (Claude Code, Claude Desktop,
// l'inspecteur MCP). Le client et son LLM décident quand les appeler ; notre code les exécute, comme dans la boucle de
// l'agent. Les mêmes définitions (nom, description, schéma zod) servent aux deux
import { McpServer } from "@modelcontextprotocol/server";
import type { Contexte, Outil } from "../agent/outil.ts";

export function creerServeurMcp(outils: Outil[], contexte: () => Contexte): McpServer {
  const serveur = new McpServer({ name: "rhea", version: "1.0.0" }, { capabilities: { tools: {} } });
  for (const outil of outils) {
    // Un outil qui agit demande l'accord du salarié (leçon 5) : ce serveur ne sait pas qui est au bout. Il n'en sert pas
    if (outil.aConfirmer) throw new Error(`${outil.nom} agit : il ne s'expose pas par ce serveur`);
    serveur.registerTool(
      outil.nom,
      {
        description: outil.description,
        inputSchema: outil.parametres, // le SDK valide les arguments avec ce schéma avant d'appeler la fonction
        // Des indices pour le client : l'outil ne modifie rien et ne sort pas de la base de Kalyo. Un client ne doit pas
        // s'y fier pour un serveur qu'il ne connaît pas : ce ne sont que des déclarations
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async (args) => {
        try {
          const { texte } = await outil.executer(args, contexte());
          return { content: [{ type: "text", text: texte }] };
        } catch (erreur) {
          // Le détail va dans le journal du client (sortie d'erreur), pas dans la réponse que lira son LLM
          console.error(`Échec de ${outil.nom} :`, erreur);
          return { content: [{ type: "text", text: "L'outil a échoué. Réessayez plus tard." }], isError: true };
        }
      },
    );
  }
  return serveur;
}
