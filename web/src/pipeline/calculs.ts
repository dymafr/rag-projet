// Ce que l'interface calcule sur une trace : l'arbre des étapes (une étape contient celles lancées pendant elle), le bilan
// d'en-tête (durée, part du LLM, tokens, coût, appels d'outils) et le coût d'un appel au LLM, avec les tarifs du serveur
import { estTerminee, type EtapeTracee, type EtapeVue, type Tarifs, type Usage } from "../types.ts";
import { ETAPES_LLM } from "./familles.ts";

export type LigneEtape = { etape: EtapeVue; profondeur: number; enfants: number };

export type Arbre = { enfants: Map<number | null, EtapeVue[]>; parId: Map<number, EtapeVue> };

export function arbreDe(etapes: EtapeVue[]): Arbre {
  const parId = new Map(etapes.map((e) => [e.id, e]));
  const enfants = new Map<number | null, EtapeVue[]>();
  for (const e of etapes) {
    const parent = e.parent !== null && parId.has(e.parent) ? e.parent : null;
    const liste = enfants.get(parent);
    if (liste) liste.push(e);
    else enfants.set(parent, [e]);
  }
  // L'ordre de départ : la trace range les étapes à leur fin (un outil après sa recherche), l'interface à leur début
  for (const liste of enfants.values()) liste.sort((a, b) => a.debut_ms - b.debut_ms || a.id - b.id);
  return { enfants, parId };
}

// Les lignes visibles, dans l'ordre de l'arbre ; les étapes repliées cachent leurs descendantes
export function lignesDe(arbre: Arbre, repliees: ReadonlySet<number>): LigneEtape[] {
  const lignes: LigneEtape[] = [];
  const visiter = (parent: number | null, profondeur: number) => {
    for (const etape of arbre.enfants.get(parent) ?? []) {
      const enfants = arbre.enfants.get(etape.id)?.length ?? 0;
      lignes.push({ etape, profondeur, enfants });
      if (enfants > 0 && !repliees.has(etape.id)) visiter(etape.id, profondeur + 1);
    }
  };
  visiter(null, 0);
  return lignes;
}

export const finDe = (e: EtapeVue, maintenant: number) => (estTerminee(e) ? e.debut_ms + e.duree_ms : Math.max(e.debut_ms, maintenant));

// Un tarif par million de tokens (eval/tarifs.json) ; null : modèle sans tarif
type Tarif = Tarifs["modeles"][string];

export type Cout = { min: number; max: number; local: boolean; inconnu: boolean };

const FOURNISSEURS_LOCAUX = new Set(["ollama", "transformers"]);

// Le même calcul que cout() du serveur (serveur : eval/comparaison.ts) : les tokens relus dans le cache coûtent moins cher,
// ceux écrits dans le cache plus cher ; sans le nombre écrit, une fourchette
export function coutDUnAppel(usage: Usage, tarif: Tarif): { min: number; max: number } {
  const nonRelus = usage.entree - usage.enCache;
  const base = (nonRelus * tarif.entree + usage.enCache * tarif.enCache + usage.sortie * tarif.sortie) / 1_000_000;
  const surcout = ((tarif.ecritureCache ?? tarif.entree) - tarif.entree) / 1_000_000;
  if (usage.ecritCache !== undefined) return { min: base + usage.ecritCache * surcout, max: base + usage.ecritCache * surcout };
  return { min: base, max: base + nonRelus * surcout };
}

export function tarifDe(etape: Pick<EtapeTracee, "modele">, tarifs: Tarifs | null): Tarif | null {
  if (!etape.modele || !tarifs) return null;
  return tarifs.modeles[`${etape.modele.fournisseur} ${etape.modele.modele}`] ?? null;
}

export function coutDe(etapes: EtapeTracee[], tarifs: Tarifs | null): Cout {
  const total: Cout = { min: 0, max: 0, local: true, inconnu: false };
  for (const e of etapes) {
    if (!e.usage) continue;
    const tarif = tarifDe(e, tarifs);
    if (tarif) {
      const c = coutDUnAppel(e.usage, tarif);
      total.min += c.min;
      total.max += c.max;
      total.local = false;
    } else if (!e.modele || !FOURNISSEURS_LOCAUX.has(e.modele.fournisseur)) {
      total.inconnu = true;
      total.local = false;
    }
  }
  return total;
}

export const estLocal = (fournisseur: string | undefined) => fournisseur !== undefined && FOURNISSEURS_LOCAUX.has(fournisseur);

export type BilanTrace = {
  duree: number;
  dureeLlm: number;
  usage: Usage;
  appelsLlm: number;
  appelsOutils: number;
  erreurs: number;
  enCours: number;
  cout: Cout;
};

export function bilanDe(etapes: EtapeVue[], tarifs: Tarifs | null, maintenant: number): BilanTrace {
  const parId = new Map(etapes.map((e) => [e.id, e]));
  // Une étape du LLM dans une autre (cela n'arrive pas aujourd'hui) ne compte qu'une fois
  const dansUnLlm = (e: EtapeVue) => {
    let p = e.parent;
    while (p !== null) {
      const parent = parId.get(p);
      if (!parent) return false;
      if (ETAPES_LLM.has(parent.nom)) return true;
      p = parent.parent;
    }
    return false;
  };
  const usage: Usage = { entree: 0, enCache: 0, sortie: 0 };
  let duree = 0;
  let dureeLlm = 0;
  let appelsLlm = 0;
  let appelsOutils = 0;
  let erreurs = 0;
  let enCours = 0;
  const terminees: EtapeTracee[] = [];
  for (const e of etapes) {
    duree = Math.max(duree, finDe(e, maintenant));
    if (e.nom === "outil") appelsOutils++;
    if (!estTerminee(e)) enCours++;
    else {
      terminees.push(e);
      if (e.statut === "erreur") erreurs++;
      if (e.usage) {
        usage.entree += e.usage.entree;
        usage.enCache += e.usage.enCache;
        usage.sortie += e.usage.sortie;
        if (e.usage.ecritCache !== undefined) usage.ecritCache = (usage.ecritCache ?? 0) + e.usage.ecritCache;
      }
    }
    if (ETAPES_LLM.has(e.nom) && !dansUnLlm(e)) {
      appelsLlm++;
      dureeLlm += finDe(e, maintenant) - e.debut_ms;
    }
  }
  return { duree, dureeLlm, usage, appelsLlm, appelsOutils, erreurs, enCours, cout: coutDe(terminees, tarifs) };
}
