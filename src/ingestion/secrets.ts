// Les secrets dans les documents (chapitre 13, leçon 4). Un salarié colle une clé d'API dans un ticket, une page de
// l'intranet garde un mot de passe : indexé, le secret peut ressortir dans une réponse, à quiconque pose la bonne
// question. On le cherche à l'ingestion, avant le découpage, et on le remplace par [secret retiré]. Le caviarder ne suffit
// pas : un secret trouvé est réputé compromis, il faut le révoquer (le bilan de npm run ingest le signale). Ces motifs
// sont ceux des formats les plus courants ; un outil dédié (gitleaks, Betterleaks, trufflehog) en connaît des centaines
import { inspect } from "node:util";

// Des motifs précis, pour peu de faux positifs : un préfixe connu suivi d'assez de caractères aléatoires
export const SECRETS: Record<string, RegExp> = {
  "clé Anthropic": /\bsk-ant-[A-Za-z0-9_-]{20,}/g,
  "clé OpenAI": /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/g,
  "clé AWS": /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, // ASIA : une clé temporaire
  // GitHub : classique, d'installation (forme de 2026 : ghs_, l'identifiant de l'app, un JWT), à grain fin
  "jeton GitHub": /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|ghs_\d+_[\w-]+\.[\w-]+\.[\w-]+|github_pat_\w{50,})/g,
  "jeton Slack": /\b(?:xox[abeprs]|xapp|xwfp)-[A-Za-z0-9-]{10,}/g, // d'un bot, d'un utilisateur, d'une application…
  "clé privée": /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  "jeton JWT": /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  // Une chaîne de connexion qui contient un mot de passe : postgres://utilisateur:mot-de-passe@hôte
  "chaîne de connexion": /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]+@\S+/gi,
  // Un mot de passe donné en clair : « mot de passe du wifi : … », « password= … », une valeur de six caractères au moins
  // dont un chiffre (« mot de passe : impossible de me connecter » n'en donne aucun)
  "mot de passe": /\b(?:mot de passe|mdp|password|passwd|pwd)\b[^:=\n]{0,30}[:=]\s*(?=\S*\d)\S{6,}/gi,
};

// Le texte caviardé, et les règles qui ont trouvé quelque chose (jamais le secret lui-même)
export function caviarder(texte: string): { texte: string; regles: string[] } {
  const regles: string[] = [];
  let resultat = texte;
  for (const [nom, motif] of Object.entries(SECRETS)) {
    resultat = resultat.replace(motif, () => {
      if (!regles.includes(nom)) regles.push(nom);
      return "[secret retiré]";
    });
  }
  return { texte: resultat, regles };
}

// Une erreur, prête pour le terminal : mise en forme comme le fait console.error (message, pile, cause, champs propres
// comme le detail de PostgreSQL), puis caviardée. Le terminal d'un serveur finit souvent dans un journal
export const pourLeTerminal = (erreur: unknown) => caviarder(typeof erreur === "string" ? erreur : inspect(erreur)).texte;
