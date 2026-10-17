// Montrer une image à un modèle de vision local (chapitre 12, leçon 4). Ollama la reçoit en base64, dans le champ images
// d'un message de son API /api/chat ; format, facultatif, impose une sortie JSON conforme à un schéma. Température 0 et
// pas de réflexion : le moins de hasard possible, sans garantie. Le modèle voit l'image en tokens visuels, environ un
// par carré de 48 pixels ; au-delà d'un plafond (mesuré avec le modèle du projet : environ 1 100 tokens), Ollama la
// réduit. Un petit chiffre manuscrit peut se perdre ou se lire de travers : d'où les contrôles qui suivent toute lecture
import { config } from "../config.ts";

export function modeleVision(): string {
  const modele = config.VISION_MODEL || (config.LLM_PROVIDER === "ollama" ? config.LLM_MODEL : "");
  if (!modele) throw new Error("Indiquez VISION_MODEL dans .env : un modèle de vision servi par Ollama");
  return modele;
}

export async function regarder(image: Buffer, consigne: string, format?: object): Promise<string> {
  const reponse = await fetch(`${config.OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: modeleVision(),
      stream: false,
      think: false,
      options: { temperature: 0 },
      messages: [{ role: "user", content: consigne, images: [image.toString("base64")] }],
      ...(format && { format }),
    }),
  }).catch((erreur: Error) => {
    throw new Error(`${erreur.message} (Ollama est-il lancé ?)`);
  });
  if (!reponse.ok) throw new Error(`Ollama a répondu ${reponse.status} : ${await reponse.text()}`);
  const corps = (await reponse.json()) as { message?: { content?: string } };
  return corps.message?.content ?? "";
}
