// Des questions candidates pour le jeu d'évaluation, rédigées par le LLM de .env à partir de passages tirés au hasard.
// Elles ne vont pas directement dans le jeu : un humain les relit, les corrige ou les écarte (eval/candidates.json)
// Lancement : npm run eval:generer -- [--nombre 8] [--graine 1]
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { z } from "zod";
import { pool } from "../db.ts";
import { creerLlm } from "../llm.ts";

const { values } = parseArgs({ options: { nombre: { type: "string", default: "8" }, graine: { type: "string", default: "1" } } });
const nombre = Number(values.nombre);
if (!Number.isInteger(nombre) || nombre < 1) throw new Error("--nombre attend un nombre entier positif, par exemple --nombre 8");

// 1. Des passages ouverts à tous et toujours en vigueur, tirés au hasard mais toujours les mêmes pour une même graine :
// md5 mélange les identifiants de façon stable. Les plus courts (un titre seul) ne permettent pas de poser une vraie question
const { rows: passages } = await pool.query<{ id: string; texte: string }>(
  `SELECT id, texte FROM chunks
   WHERE acces = 'tous' AND type <> 'ticket' AND length(texte) > 300
     AND date_effet <= CURRENT_DATE AND (date_fin IS NULL OR date_fin > CURRENT_DATE)
   ORDER BY md5(id || $1) LIMIT $2`,
  [values.graine, nombre],
);
await pool.end();

// 2. Pour chaque passage, une question qu'un salarié pourrait poser, et la réponse que donne le passage.
// Le LLM tend à reprendre les mots du passage, ce qui rend la recherche trop facile : on lui demande les siens
const CONSIGNE = `Tu prépares un jeu de test pour un assistant RH. À partir du passage ci-dessous, écris UNE question qu'un salarié
pourrait poser, et dont la réponse se trouve dans ce passage. Formule-la comme un salarié pressé, avec ses propres mots :
ne reprends ni le titre ni les expressions exactes du passage. Puis donne la réponse en une ou deux phrases, tirée du passage.
Réponds uniquement avec un objet JSON : {"question": "...", "reponse": "..."}`;
const Candidat = z.strictObject({ question: z.string().min(1), reponse: z.string().min(1) });

// Un modèle local entoure parfois le JSON de texte ou de balises : on garde ce qui va de la première { à la dernière }
function lireJson(texte: string): unknown {
  try {
    return JSON.parse(texte.match(/\{[\s\S]*\}/)?.[0] ?? "");
  } catch {
    return null;
  }
}

const llm = creerLlm();
const candidates = [];
for (const passage of passages) {
  const { texte } = await llm(CONSIGNE, `<passage>\n${passage.texte}\n</passage>`);
  const lu = Candidat.safeParse(lireJson(texte));
  if (!lu.success) {
    console.log(`${passage.id} : réponse illisible, ignorée`);
    continue;
  }
  candidates.push({ ...lu.data, categorie: "couverte", origine: "synthetique", passages: { [passage.id]: 2 } });
  console.log(`${passage.id} : ${lu.data.question}`);
}

// 3. Un fichier à relire : chaque candidate gardée reçoit un identifiant, d'autres passages pertinents, puis entre dans eval/jeu.json
await writeFile("eval/candidates.json", `${JSON.stringify(candidates, null, 2)}\n`);
console.log(`\n${candidates.length} candidates sur ${passages.length} passages, dans eval/candidates.json : à relire avant d'en garder une`);
