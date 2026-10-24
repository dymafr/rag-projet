// L'index : les documents que le profil du salarié connecté peut lire, filtrables par type, niveau d'accès et texte.
// Changer de salarié change ce qu'on voit : la liste se relit avec ses droits, rien d'un document réservé ne reste affiché
import { useMemo } from "react";
import { useRequete } from "../api/requete.ts";
import { EtatErreur, EtatVide, SqueletteLignes } from "../composants/elements.tsx";
import { Icone } from "../composants/Icone.tsx";
import { PastilleAcces } from "../composants/PastilleAcces.tsx";
import { useServeur } from "../contextes/serveur.tsx";
import { useSession } from "../contextes/session.tsx";
import { dateCourte, nombre, nomsDesSites, pluriel } from "../outils/format.ts";
import { changerParametres, cheminDuDocument, Lien, naviguer, useAdresse } from "../routeur.tsx";
import type { DocumentIndexe } from "../types.ts";

// Les niveaux qu'un profil peut lire (serveur : recherche/droits.ts, NIVEAUX)
const NIVEAUX: Record<string, string[]> = { salarie: ["tous"], manager: ["tous", "manager"], rh: ["tous", "manager", "rh"] };

type Tri = "document" | "titre" | "type" | "date" | "passages" | "tokens";

const sansAccents = (t: string) =>
  t
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

export function VueIndex() {
  const serveur = useServeur();
  const { matricule, fiche } = useSession();
  const documents = useRequete<DocumentIndexe[]>(serveur.inspection ? "/api/documents" : null, matricule);
  const { parametres } = useAdresse();
  const texte = parametres.get("q") ?? "";
  const type = parametres.get("type") ?? "";
  const acces = parametres.get("acces") ?? "";
  const tri = (parametres.get("tri") ?? "document") as Tri;
  const sens = parametres.get("sens") === "desc" ? -1 : 1;

  const tous = documents.etat === "ok" ? documents.donnees : [];
  const types = useMemo(() => {
    const c = new Map<string, number>();
    for (const d of tous) c.set(d.type, (c.get(d.type) ?? 0) + 1);
    return [...c].sort((a, b) => a[0].localeCompare(b[0]));
  }, [tous]);
  const niveaux = useMemo(() => {
    const c = new Map<string, number>();
    for (const d of tous) c.set(d.acces, (c.get(d.acces) ?? 0) + 1);
    return ["tous", "manager", "rh"].filter((n) => c.has(n)).map((n) => [n, c.get(n) ?? 0] as const);
  }, [tous]);
  const visibles = useMemo(() => {
    const mots = sansAccents(texte).split(/\s+/).filter(Boolean);
    const cles: Record<Tri, (a: DocumentIndexe, b: DocumentIndexe) => number> = {
      document: (a, b) => a.document.localeCompare(b.document, "fr", { numeric: true }),
      titre: (a, b) => a.titre.localeCompare(b.titre, "fr"),
      type: (a, b) => a.type.localeCompare(b.type) || a.document.localeCompare(b.document),
      date: (a, b) => a.date_effet.localeCompare(b.date_effet),
      passages: (a, b) => a.passages - b.passages,
      tokens: (a, b) => a.tokens - b.tokens,
    };
    return tous
      .filter((d) => (!type || d.type === type) && (!acces || d.acces === acces) && mots.every((m) => sansAccents(`${d.document} ${d.titre}`).includes(m)))
      .sort((a, b) => cles[tri](a, b) * sens);
  }, [tous, texte, type, acces, tri, sens]);

  const totalPassages = visibles.reduce((s, d) => s + d.passages, 0);
  const totalTokens = visibles.reduce((s, d) => s + d.tokens, 0);
  const lisibles = fiche ? NIVEAUX[fiche.role] ?? [] : [];

  const trier = (t: Tri) => changerParametres({ tri: t === "document" && tri === "document" && sens === 1 ? null : t, sens: tri === t && sens === 1 ? "desc" : null });
  const enTete = (t: Tri, libelle: string, classe?: string) => (
    <th scope="col" className={classe} aria-sort={tri === t ? (sens === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className="tri" onClick={() => trier(t)}>
        {libelle}
        <Icone nom={tri === t ? (sens === 1 ? "fleche-haut" : "fleche-bas") : "tri"} taille={12} />
      </button>
    </th>
  );

  if (serveur.inspection === false) {
    return (
      <div className="vue-page">
        <EtatVide icone="cadenas" titre="Inspection désactivée">
          Le serveur tourne sans le mode inspection&nbsp;: l'index n'est pas lisible depuis l'interface.
        </EtatVide>
      </div>
    );
  }

  return (
    <div className="vue-page">
      <div className="vue-page-contenu">
        <header className="entete-de-page">
          <div className="entete-de-page-titres">
            <h1>Index</h1>
            <p>
              Les documents que lit {fiche ? `le profil ${fiche.role}` : "le salarié connecté"}
              {lisibles.length > 0 && (
                <>
                  {" "}
                  (niveaux d'accès{" "}
                  {lisibles.map((n, i) => (
                    <span key={n}>
                      {i > 0 ? ", " : ""}
                      <strong>{n}</strong>
                    </span>
                  ))}
                  )
                </>
              )}
              , relus avec ses droits. Changez de salarié en haut de la page&nbsp;: la liste change avec lui, et un document réservé n'apparaît jamais.
            </p>
          </div>
        </header>

        <section className="carte" aria-labelledby="documents-titre">
          <header className="carte-entete">
            <h2 className="carte-titre" id="documents-titre">
              Documents
            </h2>
            {documents.etat === "ok" && (
              <span className="muet petit">
                {pluriel(visibles.length, "document")} · {pluriel(totalPassages, "passage")} · {nombre(totalTokens)} tokens
              </span>
            )}
          </header>
          <div className="barre-filtres">
            <label className="champ champ-en-ligne champ-filtre-texte">
              <span className="visuellement-cache">Filtrer les documents</span>
              <Icone nom="recherche" taille={14} />
              <input data-champ-principal type="search" placeholder="Identifiant ou titre…" value={texte} onChange={(e) => changerParametres({ q: e.target.value || null })} />
            </label>
            <label className="champ champ-en-ligne">
              <span className="visuellement-cache">Type de document</span>
              <select value={type} onChange={(e) => changerParametres({ type: e.target.value || null })}>
                <option value="">Tous les types</option>
                {types.map(([t, n]) => (
                  <option key={t} value={t}>
                    {t} ({nombre(n)})
                  </option>
                ))}
              </select>
            </label>
            <div className="segments" role="group" aria-label="Niveau d'accès">
              <button type="button" aria-pressed={acces === ""} className={acces === "" ? "actif" : undefined} onClick={() => changerParametres({ acces: null })}>
                Tous les niveaux
              </button>
              {niveaux.map(([n, c]) => (
                <button key={n} type="button" aria-pressed={acces === n} className={acces === n ? "actif" : undefined} onClick={() => changerParametres({ acces: n })}>
                  {n} <span className="segments-nombre">{nombre(c)}</span>
                </button>
              ))}
            </div>
          </div>
          {documents.etat === "chargement" ? (
            <SqueletteLignes lignes={10} libelle="Chargement de l'index" />
          ) : documents.etat === "erreur" ? (
            <EtatErreur message={documents.erreur.message} reessayer={documents.recharger} />
          ) : visibles.length === 0 ? (
            <EtatVide icone="filtre" titre={tous.length === 0 ? "Aucun document lisible" : "Aucun document ne correspond"}>
              {tous.length === 0 ? "Ce profil ne lit aucun document de l'index." : "Changez ou retirez un filtre."}
            </EtatVide>
          ) : (
            <div className="tableau-questions-cadre">
              <table className="tableau tableau-documents">
                <thead>
                  <tr>
                    {enTete("document", "Document")}
                    {enTete("titre", "Titre")}
                    {enTete("type", "Type")}
                    <th scope="col">Accès</th>
                    <th scope="col">Langue</th>
                    <th scope="col">Sites</th>
                    {enTete("date", "En vigueur")}
                    {enTete("passages", "Passages", "col-nombre")}
                    {enTete("tokens", "Tokens", "col-nombre")}
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((d) => (
                    <tr key={d.document} className="ligne-cliquable" onClick={(e) => (e.target as HTMLElement).closest("a, button") || naviguer(cheminDuDocument(d.document))}>
                      <td className="mono">
                        <Lien vers={cheminDuDocument(d.document)}>{d.document}</Lien>
                      </td>
                      <td>{d.titre}</td>
                      <td className="petit">{d.type}</td>
                      <td>
                        <PastilleAcces acces={d.acces} />
                      </td>
                      <td className="petit mono">{d.langue}</td>
                      <td className="petit">{nomsDesSites(d.sites)}</td>
                      <td className="petit">
                        {dateCourte(d.date_effet)}
                        {d.date_fin ? ` → ${dateCourte(d.date_fin)}` : ""}
                      </td>
                      <td className="col-nombre">{nombre(d.passages)}</td>
                      <td className="col-nombre muet">{nombre(d.tokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
