// Les tickets RH : la question d'un salarié et la réponse du service RH, dans un fichier JSON
import { readFile } from "node:fs/promises";

export type Ticket = {
  id: string;
  date: string;
  site: "lyon" | "nantes";
  demandeur: { matricule: string; prenom: string; nom: string };
  categorie: string;
  sujet: string;
  message: string;
  reponse: string | null; // pas encore de réponse tant que le ticket est en cours
  traite_par: string;
  statut: "clos" | "en_cours";
};

export async function chargerTickets(chemin = "corpus/tickets/tickets.json"): Promise<Ticket[]> {
  return JSON.parse(await readFile(chemin, "utf8"));
}

// Ce qui entoure le contenu d'un message écrit vite, et n'apprend rien à Rhéa.
// Les motifs viennent de la lecture d'une vingtaine de tickets ; ils s'appliquent dans l'ordre
const BRUIT = [
  /^([Bb]onjour|[Bb]jr|[Hh]ello|[Ss]alut)\b( \p{Lu}[\p{L}-]*[,.!]|[,.!])?\s*/u, // formule d'appel, au plus suivie d'un prénom ponctué : « Bonjour Sophie, »
  /\s*envoyé depuis mon (téléphone|mobile)\.?\s*$/i,
  /\s*[\p{L}' -]+, (service RH|HR department)\.?\s*$/iu, // signature du service RH
  /\s*(bien à vous|(bien )?cordialement|bonne (fin de )?journ[ée]e|belle journée|best regards|bon voyage|bon rétablissement[^.!]*)[,.!]?\s*$/i,
  /[\s,]*\b(merci|thanks|thx)\b[^?]{0,30}$/i, // « Merci. Claire », « Thanks a lot, Nicolas », mais pas « je vous remercie »
];

export function nettoyer(texte: string, ticket: Ticket): string {
  const sansBruit = BRUIT.reduce((t, motif) => t.replace(motif, ""), texte.trim());
  // Un message signé du seul prénom (« … que j'avance. Karim »), sans lettre collée avant ou après.
  // Le prénom est échappé : un caractère spécial des expressions régulières (point, parenthèse…) y reste un caractère
  const prenom = ticket.demandeur.prenom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return sansBruit.replace(new RegExp(`[\\s,.]*(?<!\\p{L})${prenom}(?!\\p{L})[^?]{0,20}$`, "u"), "").trim();
}

// Ce qu'on indexe : la question et la réponse. Ni le demandeur, ni la personne qui a répondu, ni le statut
export function texteDuTicket(ticket: Ticket): string {
  const question = nettoyer(ticket.message, ticket);
  const reponse = nettoyer(ticket.reponse ?? "", ticket);
  return `Question : ${question}\n\nRéponse du service RH : ${reponse}`;
}

// Les données personnelles qu'un motif sait repérer. On les signale ici ; le chapitre 13 les traitera
const MOTIFS: Record<string, RegExp> = {
  téléphone: /\b0\d(?:[ .]?\d{2}){4}\b/,
  santé: /malad|arr[eê]t de travail|enceinte|grossesse|accouch|handicap|h[oô]pital|m[eé]decin|fi[eè]vre|grippe|angine|varicelle|hernie|op[eé]r[eé]|alzheimer/i,
};

export function donneesPersonnelles(texte: string, ticket: Ticket): string[] {
  const trouvees = Object.keys(MOTIFS).filter((nom) => MOTIFS[nom].test(texte));
  // Le demandeur est connu : son prénom ou son nom dans le texte le rend identifiable
  const { prenom, nom } = ticket.demandeur;
  if (texte.includes(prenom) || texte.includes(nom)) trouvees.unshift("nom");
  return trouvees;
}
