// Le journal de l'agent : une ligne JSON par appel d'outil, dans journal/agent-AAAA-MM-JJ.jsonl. On y retrouve, après
// coup, ce que l'agent a fait, pour qui, avec quels arguments, et ce que ça a donné. Le dossier est exclu de Git : il
// contient des données personnelles (matricules, messages des tickets)
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { EntreeJournal } from "./boucle.ts";

export function journalJsonl(dossier = "journal") {
  return async (entree: EntreeJournal) => {
    await mkdir(dossier, { recursive: true });
    // Un fichier par jour : il se lit, se garde ou s'efface jour par jour
    await appendFile(join(dossier, `agent-${entree.horodatage.slice(0, 10)}.jsonl`), JSON.stringify(entree) + "\n");
  };
}
