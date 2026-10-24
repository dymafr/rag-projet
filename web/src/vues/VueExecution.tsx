// Une exécution d'évaluation : son bilan (par type, profil, catégorie) et le tableau de ses questions, filtrable et
// triable. Le jeu caché ne montre que ses scores : le serveur refuse la liste de ses questions (403)
import { useMemo } from "react";
import { useRequete } from "../api/requete.ts";
import { LECONS } from "../api/client.ts";
import { Carte, Definitions, EtatErreur, EtatLecon, EtatVide, SqueletteLignes } from "../composants/elements.tsx";
import { Icone } from "../composants/Icone.tsx";
import { useServeur } from "../contextes/serveur.tsx";
import { cout as formaterCout, date as formaterDate, duree as formaterDuree, nombre, pluriel } from "../outils/format.ts";
import { changerParametres, cheminDeLaQuestion, Lien, naviguer, useAdresse } from "../routeur.tsx";
import type { DetailExecution, QuestionEnBref, ResumeExecution } from "../types.ts";
import { AnneauScore, BarresBilan, CATEGORIES, libelleType, PastilleJeu, PastilleStatut, PuceCritere, statutDe, type Statut } from "./evaluations/communs.tsx";

export function VueExecution({ nom }: { nom: string }) {
  const serveur = useServeur();
  const resumes = useRequete<ResumeExecution[]>(serveur.inspection ? "/api/evaluations" : null);
  const detail = useRequete<DetailExecution>(serveur.inspection ? `/api/evaluations/${encodeURIComponent(nom)}` : null);
  const resume = detail.etat === "ok" ? detail.donnees.resume : resumes.etat === "ok" ? resumes.donnees.find((r) => r.nom === nom) : undefined;
  const cache = detail.etat === "erreur" && detail.erreur.statut === 403;

  if (serveur.inspection === false) {
    return (
      <div className="vue-page">
        <EtatVide icone="cadenas" titre="Inspection désactivée">
          Le serveur tourne sans le mode inspection&nbsp;: les évaluations ne sont pas lisibles.
        </EtatVide>
      </div>
    );
  }

  return (
    <div className="vue-page">
      <div className="vue-page-contenu">
        <nav className="fil-d-ariane" aria-label="Fil d'Ariane">
          <Lien vers="/evaluations">Évaluations</Lien>
          <Icone nom="chevron-droite" taille={12} />
          <span className="mono">{nom}</span>
        </nav>
        {detail.etat === "erreur" && detail.erreur.routeAbsente ? (
          <EtatLecon lecon={LECONS.evaluations.lecon} sujet={LECONS.evaluations.sujet} />
        ) : detail.etat === "erreur" && detail.erreur.statut === 404 ? (
          <EtatVide icone="question" titre="Évaluation introuvable" action={<Lien vers="/evaluations">Voir toutes les évaluations</Lien>}>
            Aucune exécution ne s'appelle <span className="mono">{nom}</span>.
          </EtatVide>
        ) : detail.etat === "erreur" && !cache ? (
          <EtatErreur message={detail.erreur.message} reessayer={detail.recharger} />
        ) : !resume ? (
          <SqueletteLignes lignes={8} libelle="Chargement de l'évaluation" />
        ) : (
          <>
            <EnTeteExecution resume={resume} />
            <div className="grille-bilans">
              <Carte titre="Par type de question" icone="liste">
                <BarresBilan groupes={resume.bilan.parType} libelle={libelleType} />
              </Carte>
              <Carte titre="Par profil" icone="utilisateur">
                <BarresBilan groupes={resume.bilan.parProfil} />
              </Carte>
              <Carte titre="Par catégorie" icone="filtre">
                <BarresBilan groupes={resume.bilan.parCategorie} libelle={(k) => CATEGORIES[k] ?? k} />
              </Carte>
            </div>
            {cache ? (
              <div className="note-jeu-cache" role="note">
                <Icone nom="cadenas" taille={18} />
                <div>
                  <p className="fort">Jeu caché&nbsp;: on n'en lit que les scores, pour ne jamais régler Rhéa dessus</p>
                  <p className="muet">
                    Ses questions, ses réponses et ses traces restent fermées, même ici&nbsp;: les lire, ce serait commencer à régler Rhéa sur elles, et le jeu
                    caché ne mesurerait plus rien.
                  </p>
                </div>
              </div>
            ) : detail.etat === "ok" ? (
              <TableauQuestions nom={nom} questions={detail.donnees.questions} />
            ) : (
              <SqueletteLignes lignes={10} libelle="Chargement des questions" />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function EnTeteExecution({ resume }: { resume: ResumeExecution }) {
  const nonJugees = resume.bilan.total - resume.bilan.jugees;
  return (
    <header className="entete-execution carte">
      <AnneauScore bilan={resume.bilan} taille={104} />
      <div className="entete-execution-textes">
        <div className="entete-execution-titre">
          <h1 className="mono">{resume.nom}</h1>
          <PastilleJeu jeu={resume.jeu} />
        </div>
        <p className="entete-execution-chiffres">
          <strong>{nombre(resume.bilan.reussies)}</strong> réussie{resume.bilan.reussies >= 2 ? "s" : ""} sur {nombre(resume.bilan.jugees)} jugée
          {resume.bilan.jugees >= 2 ? "s" : ""} · {pluriel(resume.bilan.total, "question")}
          {nonJugees > 0 ? ` dont ${pluriel(nonJugees, "non jugée", "non jugées")}` : ""}
        </p>
        <p className="muet petit">
          {formaterDate(resume.date)} · {formaterDuree(resume.duree_ms)} · {resume.cout === null ? "coût nul (modèles locaux)" : formaterCout(resume.cout)}
        </p>
      </div>
      <Definitions
        lignes={[
          ["Génération", <span className="mono">{resume.configuration.generation}</span>],
          ["Juge", <span className="mono">{resume.configuration.juge}</span>],
          ["Embeddings", <span className="mono">{resume.configuration.embeddings}</span>],
          ["Reclasseur", <span className="mono">{resume.configuration.reclasseur ?? "aucun"}</span>],
          ["Recherche", resume.configuration.recherche],
          ["Prompt", <span className="mono">{resume.configuration.prompt}</span>],
          ["Empreinte du jeu", <span className="mono empreinte" title={resume.empreinteDuJeu}>{resume.empreinteDuJeu.slice(0, 16)}…</span>],
        ]}
      />
    </header>
  );
}

type Tri = "id" | "statut" | "duree" | "cout" | "type";
const ORDRE_STATUT: Record<Statut, number> = { echouee: 0, erreur: 1, "non-jugee": 2, reussie: 3 };
// Q2 avant Q10 : l'ordre naturel des identifiants
const comparerIds = (a: string, b: string) => a.localeCompare(b, "fr", { numeric: true });

function TableauQuestions({ nom, questions }: { nom: string; questions: QuestionEnBref[] }) {
  const { parametres } = useAdresse();
  const statut = parametres.get("statut") ?? "";
  const type = parametres.get("type") ?? "";
  const profil = parametres.get("profil") ?? "";
  const texte = parametres.get("q") ?? "";
  const tri = (parametres.get("tri") ?? "id") as Tri;
  const sens = parametres.get("sens") === "desc" ? -1 : 1;

  const types = useMemo(() => [...new Set(questions.map((q) => q.type))].sort(), [questions]);
  const profils = useMemo(() => [...new Set(questions.map((q) => q.profil))].sort(), [questions]);
  const visibles = useMemo(() => {
    const mots = texte.toLowerCase().split(/\s+/).filter(Boolean);
    const liste = questions.filter((q) => {
      if (statut && statutDe(q.reussie, q.erreur) !== statut) return false;
      if (type && q.type !== type) return false;
      if (profil && q.profil !== profil) return false;
      const contenu = `${q.id} ${q.question} ${q.matricule}`.toLowerCase();
      return mots.every((m) => contenu.includes(m));
    });
    const cle: Record<Tri, (a: QuestionEnBref, b: QuestionEnBref) => number> = {
      id: (a, b) => comparerIds(a.id, b.id),
      statut: (a, b) => ORDRE_STATUT[statutDe(a.reussie, a.erreur)] - ORDRE_STATUT[statutDe(b.reussie, b.erreur)] || comparerIds(a.id, b.id),
      duree: (a, b) => a.duree_ms - b.duree_ms,
      cout: (a, b) => (a.cout ?? 0) - (b.cout ?? 0),
      type: (a, b) => a.type.localeCompare(b.type) || comparerIds(a.id, b.id),
    };
    return liste.sort((a, b) => cle[tri](a, b) * sens);
  }, [questions, statut, type, profil, texte, tri, sens]);

  const comptes = useMemo(() => {
    const c: Record<string, number> = {};
    for (const q of questions) c[statutDe(q.reussie, q.erreur)] = (c[statutDe(q.reussie, q.erreur)] ?? 0) + 1;
    return c;
  }, [questions]);

  const trier = (t: Tri) => changerParametres({ tri: t === "id" && tri === "id" && sens === 1 ? null : t, sens: tri === t && sens === 1 ? "desc" : null });
  const enTete = (t: Tri, libelle: string, classe?: string) => (
    <th scope="col" className={classe} aria-sort={tri === t ? (sens === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className="tri" onClick={() => trier(t)}>
        {libelle}
        <Icone nom={tri === t ? (sens === 1 ? "fleche-haut" : "fleche-bas") : "tri"} taille={12} />
      </button>
    </th>
  );

  return (
    <section className="carte" aria-labelledby="questions-titre">
      <header className="carte-entete">
        <h2 className="carte-titre" id="questions-titre">
          Questions
        </h2>
        <span className="muet petit">
          {nombre(visibles.length)} sur {nombre(questions.length)}
        </span>
      </header>
      <div className="barre-filtres">
        <div className="segments" role="group" aria-label="Statut">
          {[
            ["", "Toutes", questions.length],
            ["echouee", "Échouées", comptes.echouee ?? 0],
            ["reussie", "Réussies", comptes.reussie ?? 0],
            ["non-jugee", "Non jugées", comptes["non-jugee"] ?? 0],
            ["erreur", "En erreur", comptes.erreur ?? 0],
          ].map(([valeur, libelle, n]) => (
            <button key={valeur} type="button" aria-pressed={statut === valeur} className={statut === valeur ? "actif" : undefined} onClick={() => changerParametres({ statut: String(valeur) || null })}>
              {libelle} <span className="segments-nombre">{nombre(Number(n))}</span>
            </button>
          ))}
        </div>
        <label className="champ champ-en-ligne">
          <span className="visuellement-cache">Type</span>
          <select value={type} onChange={(e) => changerParametres({ type: e.target.value || null })}>
            <option value="">Tous les types</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {libelleType(t)}
              </option>
            ))}
          </select>
        </label>
        <label className="champ champ-en-ligne">
          <span className="visuellement-cache">Profil</span>
          <select value={profil} onChange={(e) => changerParametres({ profil: e.target.value || null })}>
            <option value="">Tous les profils</option>
            {profils.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="champ champ-en-ligne champ-filtre-texte">
          <span className="visuellement-cache">Rechercher une question</span>
          <Icone nom="recherche" taille={14} />
          <input data-champ-principal type="search" placeholder="Identifiant, question, matricule…" value={texte} onChange={(e) => changerParametres({ q: e.target.value || null })} />
        </label>
      </div>
      {visibles.length === 0 ? (
        <EtatVide icone="filtre" titre="Aucune question ne correspond">
          Changez ou retirez un filtre.
        </EtatVide>
      ) : (
        <div className="tableau-questions-cadre">
          <table className="tableau tableau-questions">
            <thead>
              <tr>
                {enTete("statut", "Statut")}
                {enTete("id", "Id")}
                <th scope="col">Question</th>
                {enTete("type", "Type")}
                <th scope="col">Critères</th>
                <th scope="col">Outils</th>
                <th scope="col" className="col-nombre" title="Sources citées, dont inventées">
                  Sources
                </th>
                {enTete("duree", "Durée", "col-nombre")}
                {enTete("cout", "Coût", "col-nombre")}
              </tr>
            </thead>
            <tbody>
              {visibles.map((q) => (
                <LigneQuestion key={q.id} nom={nom} question={q} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function LigneQuestion({ nom, question: q }: { nom: string; question: QuestionEnBref }) {
  const vers = cheminDeLaQuestion(nom, q.id) + location.search;
  return (
    <tr className="ligne-cliquable" onClick={(e) => (e.target as HTMLElement).closest("a, button") || naviguer(vers)}>
      <td>
        <PastilleStatut statut={statutDe(q.reussie, q.erreur)} />
      </td>
      <td className="mono">
        <Lien vers={vers}>{q.id}</Lien>
      </td>
      <td className="col-question">
        <span className="question-texte">{q.question}</span>
        <span className="muet petit">
          {q.profil} · {q.matricule}
        </span>
      </td>
      <td className="petit">{libelleType(q.type)}</td>
      <td>
        <span className="puces-criteres">
          {q.criteres.map((c) => (
            <PuceCritere key={c.critere} critere={c.critere} ok={c.ok} />
          ))}
        </span>
      </td>
      <td className="col-outils" title={q.outils.join(", ")}>
        {q.outils.length === 0 ? (
          <span className="muet">–</span>
        ) : (
          <span className="outils-courts">
            {q.outils.map((o, i) => (
              <span key={i}>{o.replace(/^consulter_/, "").replace(/_/g, " ")}</span>
            ))}
          </span>
        )}
      </td>
      <td className="col-nombre">
        {nombre(q.citees)}
        {q.inventees > 0 && <span className="inventees" title="Sources inventées"> +{nombre(q.inventees)}</span>}
      </td>
      <td className="col-nombre">{formaterDuree(q.duree_ms)}</td>
      <td className="col-nombre muet">{q.cout === null ? "–" : formaterCout(q.cout)}</td>
    </tr>
  );
}
