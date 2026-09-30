// Les tickets RH vus par l'ingestion : ce qu'on garde, ce qu'on écarte, les données personnelles qui restent
// Lancement : npm run tickets -- TK-2026-0038
import { chargerTickets, donneesPersonnelles, texteDuTicket } from "../ingestion/tickets.ts";

const tickets = await chargerTickets();
// Un ticket sans réponse n'apprend rien à Rhéa : on l'écarte
const aIndexer = tickets.filter((t) => t.statut === "clos" && t.reponse);
console.log(`${tickets.length} tickets : ${aIndexer.length} avec une réponse, ${tickets.length - aIndexer.length} écartés\n`);

// 1. Un ticket, brut puis tel qu'il sera indexé
const ticket = aIndexer.find((t) => t.id === process.argv[2]) ?? aIndexer[0];
console.log(`--- ${ticket.id}, brut\n${JSON.stringify(ticket, null, 2)}\n`);
console.log(`--- ${ticket.id}, indexé (titre : ${ticket.sujet})\n${texteDuTicket(ticket)}\n`);

// 2. Les données personnelles, dans le texte brut et dans le texte indexé
const compter = (texte: (t: (typeof aIndexer)[number]) => string) => {
  const nombres = new Map<string, number>();
  for (const t of aIndexer) {
    for (const donnee of donneesPersonnelles(texte(t), t)) nombres.set(donnee, (nombres.get(donnee) ?? 0) + 1);
  }
  return nombres;
};
const avant = compter((t) => `${t.sujet} ${t.message} ${t.reponse}`);
const apres = compter((t) => `${t.sujet} ${texteDuTicket(t)}`);
console.log("Tickets contenant des données personnelles   avant nettoyage   après");
for (const donnee of avant.keys()) {
  console.log(`  ${donnee.padEnd(44)} ${String(avant.get(donnee)).padStart(15)} ${String(apres.get(donnee) ?? 0).padStart(7)}`);
}
