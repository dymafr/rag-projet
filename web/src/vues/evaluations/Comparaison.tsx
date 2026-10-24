// La comparaison de deux exécutions du jeu de travail : les questions gagnées, perdues, inchangées, et le test de McNemar
// exact, calculé ici, avec une phrase qui dit si l'écart est démontré
import { useMemo } from "react";
import { useRequete } from "../../api/requete.ts";
import { Carte, EtatErreur, EtatVide, Pastille, SqueletteLignes } from "../../composants/elements.tsx";
import { Icone } from "../../composants/Icone.tsx";
import { decimal, nombre, pluriel } from "../../outils/format.ts";
import { gainsManquants, mcnemarExact, SEUIL_P } from "../../outils/mcnemar.ts";
import { changerParametres, cheminDeLaQuestion, cheminDeLExecution, Lien } from "../../routeur.tsx";
import type { DetailExecution, QuestionEnBref, ResumeExecution } from "../../types.ts";
import { AnneauScore, libelleType } from "./communs.tsx";
import { Desaccords } from "./Desaccords.tsx";

type Ligne = { id: string; question: string; type: string; a: boolean | null; b: boolean | null };

export function Comparaison({ executions, a, b }: { executions: ResumeExecution[]; a: string; b: string }) {
  const travail = executions.filter((e) => e.jeu === "travail");
  const detailA = useRequete<DetailExecution>(`/api/evaluations/${encodeURIComponent(a)}`);
  const detailB = useRequete<DetailExecution>(`/api/evaluations/${encodeURIComponent(b)}`);
  return (
    <>
      <header className="entete-de-page">
        <div className="entete-de-page-titres">
          <nav className="fil-d-ariane" aria-label="Fil d'Ariane">
            <Lien vers="/evaluations">Évaluations</Lien>
            <Icone nom="chevron-droite" taille={12} />
            <span>Comparaison</span>
          </nav>
          <h1>Comparer deux exécutions</h1>
          <p>Sur les questions communes aux deux exécutions. Seules celles qui changent de verdict départagent&nbsp;: le test de McNemar exact dit si l'écart peut venir du hasard.</p>
        </div>
      </header>
      <div className="choix-comparaison carte">
        <label className="champ">
          <span className="champ-libelle">A, la référence</span>
          <select value={a} onChange={(e) => changerParametres({ comparer: e.target.value })}>
            {travail.map((e) => (
              <option key={e.nom} value={e.nom}>
                {e.nom} ({e.date})
              </option>
            ))}
          </select>
        </label>
        <Icone nom="fleche-droite" taille={18} />
        <label className="champ">
          <span className="champ-libelle">B, la candidate</span>
          <select value={b} onChange={(e) => changerParametres({ avec: e.target.value })}>
            {travail.map((e) => (
              <option key={e.nom} value={e.nom}>
                {e.nom} ({e.date})
              </option>
            ))}
          </select>
        </label>
      </div>
      {detailA.etat === "erreur" || detailB.etat === "erreur" ? (
        <EtatErreur
          message={(detailA.etat === "erreur" ? detailA.erreur.message : detailB.etat === "erreur" ? detailB.erreur.message : "") || "Lecture impossible"}
          reessayer={() => {
            detailA.recharger();
            detailB.recharger();
          }}
        />
      ) : detailA.etat === "ok" && detailB.etat === "ok" ? (
        a === b ? (
          <EtatVide icone="comparer" titre="Deux fois la même exécution">
            Choisissez deux exécutions différentes.
          </EtatVide>
        ) : (
          <Resultats a={detailA.donnees} b={detailB.donnees} />
        )
      ) : (
        <SqueletteLignes lignes={8} libelle="Chargement des deux exécutions" />
      )}
    </>
  );
}

function Resultats({ a, b }: { a: DetailExecution; b: DetailExecution }) {
  const { lignes, seulement } = useMemo(() => {
    const parIdB = new Map(b.questions.map((q) => [q.id, q]));
    const communes: Ligne[] = [];
    for (const q of a.questions) {
      const autre = parIdB.get(q.id);
      if (autre) communes.push({ id: q.id, question: q.question, type: q.type, a: verdict(q), b: verdict(autre) });
    }
    return { lignes: communes, seulement: a.questions.length + b.questions.length - 2 * communes.length };
  }, [a, b]);
  const gagnees = lignes.filter((l) => l.a === false && l.b === true);
  const perdues = lignes.filter((l) => l.a === true && l.b === false);
  const reussiesDesDeux = lignes.filter((l) => l.a === true && l.b === true).length;
  const echoueesDesDeux = lignes.filter((l) => l.a === false && l.b === false).length;
  const incomparables = lignes.filter((l) => l.a === null || l.b === null);
  const p = mcnemarExact(gagnees.length, perdues.length);
  const demontre = gagnees.length + perdues.length > 0 && p < SEUIL_P;
  const meilleure = gagnees.length > perdues.length ? "B" : "A";
  const manquants = gainsManquants(Math.max(gagnees.length, perdues.length), Math.min(gagnees.length, perdues.length));
  const pTexte = p < 0.001 ? "p < 0,001" : `p = ${decimal(p, 3)}`;

  return (
    <>
      <div className="comparaison-entete">
        <Carte className="comparaison-execution">
          <AnneauScore bilan={a.resume.bilan} taille={64} />
          <div>
            <p className="surtitre">A</p>
            <Lien vers={cheminDeLExecution(a.resume.nom)} className="mono fort">
              {a.resume.nom}
            </Lien>
            <p className="muet petit">{a.resume.configuration.generation}</p>
          </div>
        </Carte>
        <Carte className="comparaison-execution">
          <AnneauScore bilan={b.resume.bilan} taille={64} />
          <div>
            <p className="surtitre">B</p>
            <Lien vers={cheminDeLExecution(b.resume.nom)} className="mono fort">
              {b.resume.nom}
            </Lien>
            <p className="muet petit">{b.resume.configuration.generation}</p>
          </div>
        </Carte>
      </div>

      <div className="comparaison-chiffres">
        <Chiffre ton="ok" valeur={gagnees.length} libelle="gagnées par B" detail="échouées par A, réussies par B" />
        <Chiffre ton="erreur" valeur={perdues.length} libelle="perdues par B" detail="réussies par A, échouées par B" />
        <Chiffre valeur={reussiesDesDeux} libelle="réussies des deux côtés" detail="inchangées" />
        <Chiffre valeur={echoueesDesDeux} libelle="échouées des deux côtés" detail="inchangées" />
        <Chiffre valeur={incomparables.length} libelle="non comparables" detail="non jugées d'un côté au moins" />
      </div>

      <div className={`verdict-mcnemar ${demontre ? "demontre" : "non-demontre"}`} role="status">
        <Icone nom={demontre ? "ok" : "info"} taille={20} />
        <div>
          <p className="verdict-mcnemar-titre">
            {gagnees.length + perdues.length === 0
              ? "Aucune question ne change de verdict\u00a0: rien ne départage les deux exécutions."
              : demontre
                ? `L'écart est démontré\u00a0: ${meilleure} fait mieux (${pTexte}, sous le seuil de 0,05).`
                : `L'écart n'est pas démontré (${pTexte}, au-dessus du seuil de 0,05).`}
          </p>
          <p className="verdict-mcnemar-texte">
            {gagnees.length + perdues.length > 0 && <>Test de McNemar exact, sur {pluriel(gagnees.length + perdues.length, "question qui change", "questions qui changent")} de verdict ({nombre(gagnees.length)} gagnée
            {gagnees.length >= 2 ? "s" : ""}, {nombre(perdues.length)} perdue{perdues.length >= 2 ? "s" : ""}).</>}
            {!demontre && manquants !== null && gagnees.length !== perdues.length
              ? ` Il faudrait ${pluriel(manquants, "question")} de plus qui change${manquants >= 2 ? "nt" : ""} dans le même sens, sans changement contraire, pour conclure.`
              : ""}
            {seulement > 0 ? ` ${pluriel(seulement, "question n'est", "questions ne sont")} que d'un côté\u00a0: écartée${seulement >= 2 ? "s" : ""} de la comparaison.` : ""}
          </p>
        </div>
      </div>

      <div className="comparaison-listes">
        <ListeQuestions titre="Gagnées par B" lignes={gagnees} nom={b.resume.nom} ton="ok" />
        <ListeQuestions titre="Perdues par B" lignes={perdues} nom={b.resume.nom} ton="erreur" />
      </div>

      <Desaccords a={a.resume.nom} b={b.resume.nom} />
    </>
  );
}

// Le verdict du juge ; une question non jugée (juge illisible, réponse en échec) ne se compare pas, comme dans le bilan
const verdict = (q: QuestionEnBref): boolean | null => q.reussie;

function Chiffre({ valeur, libelle, detail, ton }: { valeur: number; libelle: string; detail: string; ton?: "ok" | "erreur" }) {
  return (
    <div className={`chiffre${ton ? ` ton-${ton}` : ""}`}>
      <span className="chiffre-valeur">{nombre(valeur)}</span>
      <span className="chiffre-libelle">{libelle}</span>
      <span className="chiffre-detail">{detail}</span>
    </div>
  );
}

function ListeQuestions({ titre, lignes, nom, ton }: { titre: string; lignes: Ligne[]; nom: string; ton: "ok" | "erreur" }) {
  return (
    <Carte titre={titre} actions={<Pastille ton={ton}>{nombre(lignes.length)}</Pastille>}>
      {lignes.length === 0 ? (
        <p className="muet petit">Aucune.</p>
      ) : (
        <ul className="liste-questions-courte">
          {lignes.map((l) => (
            <li key={l.id}>
              <Lien vers={cheminDeLaQuestion(nom, l.id)} className="mono">
                {l.id}
              </Lien>
              <span className="une-ligne" title={l.question}>
                {l.question}
              </span>
              <span className="muet petit">{libelleType(l.type)}</span>
            </li>
          ))}
        </ul>
      )}
    </Carte>
  );
}
