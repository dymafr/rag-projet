// Supprimer le vector store et les fichiers téléversés. Retirer un fichier du store ne le supprime pas : il reste
// stocké chez OpenAI tant qu'on ne le supprime pas lui aussi
// Lancement : npm run store:supprimer
import { rm } from "node:fs/promises";
import { NotFoundError } from "openai";
import { clientOpenAI } from "../gere/client.ts";
import { FICHIER_STORE, lireStore } from "../gere/store.ts";

// Un store ou un fichier déjà supprimé (depuis le tableau de bord, ou par une exécution interrompue) répond 404 : on
// continue, pour ne pas laisser chez OpenAI les fichiers qui restent. Toute autre erreur arrête le script
async function supprimer(suppression: () => Promise<unknown>): Promise<boolean> {
  try {
    await suppression();
    return true;
  } catch (erreur) {
    if (erreur instanceof NotFoundError) return false;
    throw erreur;
  }
}

const client = clientOpenAI();
const store = await lireStore();
const supprime = await supprimer(() => client.vectorStores.delete(store.id));
console.log(`Vector store ${store.id} ${supprime ? "supprimé" : "déjà supprimé"}`);
let n = 0;
for (const fichier of Object.values(store.fichiers)) {
  if (await supprimer(() => client.files.delete(fichier))) n++;
}
await rm(FICHIER_STORE);
console.log(`${n} fichiers supprimés ; ${FICHIER_STORE} effacé`);
