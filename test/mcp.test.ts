// Tests du serveur MCP de Rhéa : un client écrit à la main lui parle en JSON-RPC, par un transport en mémoire. On voit
// passer les messages du protocole : la poignée de main, la liste des outils, un appel. Ni base, ni LLM. Lancement : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { z } from "zod";
import { chercherDocuments } from "../src/agent/chercher.ts";
import { definirOutil } from "../src/agent/outil.ts";
import { creerServeurMcp } from "../src/mcp/serveur.ts";
import type { Resultat } from "../src/recherche/vectorielle.ts";

const faq: Resultat = { id: "FAQ-RH#2", document: "FAQ-RH", titres: ["FAQ RH de Kalyo", "Télétravail"], texte: "Jusqu'à trois jours par semaine.", score: 0.888 };
let appels = 0; const recherche = chercherDocuments(async () => { appels += 1; return [faq]; });

// Un client minimal : il envoie une requête et attend la réponse qui porte le même identifiant
async function connecter() {
  const [client, serveur] = InMemoryTransport.createLinkedPair();
  await creerServeurMcp([recherche], () => ({ date: "2026-10-13", profil: "salarie" as const })).connect(serveur);
  const attentes = new Map<number, (message: any) => void>();
  client.onmessage = (message: any) => attentes.get(message.id)?.(message);
  await client.start();
  let id = 0;
  const demander = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<any>((resoudre) => {
      id += 1;
      attentes.set(id, resoudre);
      void client.send({ jsonrpc: "2.0", id, method, params });
    });
  // La poignée de main de la génération 2025 du protocole : initialize, puis la notification initialized
  const init = await demander("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  await client.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  return { init, demander, fermer: () => client.close() };
}

test("le serveur se présente et liste ses outils, avec leur schéma et leurs annotations", async () => {
  const { init, demander, fermer } = await connecter();
  assert.equal(init.result.serverInfo.name, "rhea");
  const { result } = await demander("tools/list");
  assert.deepEqual(result.tools.map((t: { name: string }) => t.name), ["chercher_documents"]);
  assert.deepEqual(result.tools[0].inputSchema.required, ["requete"]);
  assert.deepEqual(result.tools[0].annotations, { readOnlyHint: true, openWorldHint: false });
  await fermer();
});

test("un appel exécute l'outil ; des arguments invalides reviennent en erreur, sans l'exécuter", async () => {
  const { demander, fermer } = await connecter();
  const bon = await demander("tools/call", { name: "chercher_documents", arguments: { requete: "télétravail" } });
  assert.match(bon.result.content[0].text, /^<passage source="FAQ-RH#2"/);
  const mauvais = await demander("tools/call", { name: "chercher_documents", arguments: { requete: 42 } });
  assert.deepEqual([mauvais.result?.isError, appels], [true, 1]); // refusé dans le résultat, recherche non relancée
  await fermer();
});

test("un outil qui agit ne s'expose pas par le serveur MCP", () => {
  const action = definirOutil({ nom: "envoyer", description: "", parametres: z.object({}), aConfirmer: () => "envoyer", executer: async () => ({ texte: "" }) });
  assert.throws(() => creerServeurMcp([action], () => ({ date: "2026-10-13", profil: "salarie" as const })), /agit/);
});
