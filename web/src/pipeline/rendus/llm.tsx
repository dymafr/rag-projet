// Les étapes du LLM : ses consignes et ses outils, chaque tour de l'agent (la conversation envoyée, les appels demandés,
// le texte rendu), un appel simple (condensation, filtres, SQL…), la réponse finale
import { BlocTexte } from "../../composants/BlocTexte.tsx";
import { Definitions, Pastille } from "../../composants/elements.tsx";
import { Icone } from "../../composants/Icone.tsx";
import { PastillePassage, TexteAvecPassages } from "../../composants/PastillePassage.tsx";
import { TexteRiche } from "../../composants/TexteRiche.tsx";
import { nombre, pluriel } from "../../outils/format.ts";
import { booleen, estObjet, liste, nombre as lireNombre, objet, texte, textes, type Objet } from "../../outils/lecture.ts";
import { JetonsLlm, JsonLisible, Modele, Section, type ProprietesRendu } from "./communs.tsx";

export function RenduPromptSysteme({ etape }: ProprietesRendu) {
  const systeme = texte(etape.details, "systeme") ?? "";
  const outils = liste(etape.details, "outils").filter(estObjet);
  return (
    <>
      <Section titre="Consignes" note="le prompt système, envoyé à chaque tour">
        <BlocTexte texte={systeme} hauteurMax={320} proportionnel />
      </Section>
      <Section titre="Outils proposés au LLM" note={pluriel(outils.length, "outil")}>
        <ul className="liste-outils">
          {outils.map((o, i) => (
            <li key={texte(o, "nom") ?? i} className="outil-carte">
              <div className="outil-carte-entete">
                <Icone nom="outil" taille={14} />
                <span className="mono fort">{texte(o, "nom")}</span>
                {booleen(o, "action") && (
                  <Pastille ton="alerte" icone="cadenas" titre="Une action&nbsp;: Rhéa demande l'accord du salarié avant de l'exécuter">
                    action, demande confirmation
                  </Pastille>
                )}
              </div>
              <p className="outil-carte-description">{texte(o, "description")}</p>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

const ROLES: Record<string, string> = { utilisateur: "Utilisateur", assistant: "Assistant (le LLM)", outil: "Résultat d'outil" };

function Message({ message, dernier }: { message: Objet; dernier: boolean }) {
  const role = texte(message, "role") ?? "inconnu";
  const contenu = texte(message, "texte") ?? "";
  const appels = liste(message, "appels").filter(estObjet);
  if (role === "outil") {
    const passages = textes(message, "passages");
    const erreur = booleen(message, "erreur") === true;
    return (
      <details className={`bulle bulle-outil${erreur ? " bulle-erreur" : ""}`}>
        <summary>
          <Icone nom="chevron-droite" taille={12} className="bulle-chevron" />
          <span className="bulle-role">{ROLES.outil}</span>
          <span className="mono">{texte(message, "nom")}</span>
          <span className="muet petit">
            {passages.length > 0 ? pluriel(passages.length, "passage") : `${nombre(contenu.length)} caractères`}
            {erreur ? " · erreur" : ""}
          </span>
        </summary>
        {passages.length > 0 && (
          <div className="pastilles-ligne">
            {passages.map((p) => (
              <PastillePassage key={p} id={p} compacte />
            ))}
          </div>
        )}
        <BlocTexte texte={contenu} avecPassages hauteurMax={240} />
      </details>
    );
  }
  return (
    <div className={`bulle bulle-${role}${dernier ? " bulle-derniere" : ""}`}>
      <span className="bulle-role">{ROLES[role] ?? role}</span>
      {contenu && (
        <div className="bulle-texte">
          <TexteAvecPassages texte={contenu} />
        </div>
      )}
      {appels.length > 0 && (
        <ul className="bulle-appels">
          {appels.map((a, i) => (
            <li key={texte(a, "id") ?? i}>
              <Icone nom="outil" taille={12} /> demande <span className="mono">{texte(a, "nom")}</span>
              <code className="mono muet appel-args">{JSON.stringify(a.arguments)}</code>
            </li>
          ))}
        </ul>
      )}
      {!contenu && appels.length === 0 && <span className="muet petit">(message vide)</span>}
    </div>
  );
}

export function RenduTourLlm({ etape, contexte }: ProprietesRendu) {
  const messages = liste(etape.details, "messages").filter(estObjet);
  const appels = liste(etape.details, "appels").filter(estObjet);
  const rendu = texte(etape.details, "texte") ?? "";
  const sansOutil = booleen(etape.details, "sansOutil") === true;
  return (
    <>
      <div className="rendu-entete-ligne">
        <Modele etape={etape} />
        <Pastille>tour {lireNombre(etape.details, "tour") ?? "?"}</Pastille>
        {sansOutil && (
          <Pastille ton="alerte" icone="drapeau">
            dernier tour, sans outil
          </Pastille>
        )}
      </div>
      <Section titre="Tokens">
        <JetonsLlm etape={etape} tarifs={contexte.tarifs} />
      </Section>
      <Section titre="Conversation envoyée" note={`${pluriel(messages.length, "message")}, après les consignes et la liste des outils`}>
        <div className="conversation-envoyee">
          {messages.map((m, i) => (
            <Message key={i} message={m} dernier={i === messages.length - 1} />
          ))}
        </div>
      </Section>
      <Section titre="Appels demandés" note={appels.length === 0 ? "aucun\u00a0: le LLM répond" : pluriel(appels.length, "appel")}>
        {appels.length === 0 ? (
          <p className="muet rendu-vide">Le LLM n'a demandé aucun outil à ce tour.</p>
        ) : (
          <ul className="appels-demandes">
            {appels.map((a, i) => (
              <li key={texte(a, "id") ?? i}>
                <div className="appel-entete">
                  <Icone nom="outil" taille={14} />
                  <span className="mono fort">{texte(a, "nom")}</span>
                  <span className="mono muet petit">{texte(a, "id")}</span>
                </div>
                <JsonLisible valeur={a.arguments} />
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section titre="Texte rendu" note={rendu ? `${nombre(rendu.length)} caractères` : undefined}>
        {rendu ? (
          <div className="texte-rendu">
            <TexteRiche texte={rendu} />
          </div>
        ) : (
          <p className="muet rendu-vide">Aucun texte&nbsp;: le LLM n'a fait que demander des outils.</p>
        )}
      </Section>
    </>
  );
}

export function RenduAppelLlm({ etape, contexte }: ProprietesRendu) {
  return (
    <>
      <div className="rendu-entete-ligne">
        <Modele etape={etape} />
      </div>
      <Section titre="Tokens">
        <JetonsLlm etape={etape} tarifs={contexte.tarifs} />
      </Section>
      <Section titre="Consigne" note="le début du prompt, qui se répète d'un appel à l'autre">
        <BlocTexte texte={texte(etape.details, "consigne") ?? ""} proportionnel />
      </Section>
      <Section titre="Message" note="la fin du prompt, propre à cet appel">
        <BlocTexte texte={texte(etape.details, "message") ?? ""} proportionnel avecPassages />
      </Section>
      <Section titre="Réponse">
        <BlocTexte texte={texte(etape.details, "reponse") ?? ""} proportionnel />
      </Section>
    </>
  );
}

export function RenduReponse({ etape, contexte }: ProprietesRendu) {
  const contenu = texte(etape.details, "texte") ?? "";
  const usage = objet(etape.details, "usage");
  const tour = contexte.etapes.findLast((e) => e.nom === "tour-llm" && "modele" in e);
  const modele = tour && "modele" in tour ? tour.modele : undefined;
  return (
    <>
      <Definitions
        lignes={[
          ["Raison", texte(etape.details, "raison") ?? "–"],
          ["Tour", String(lireNombre(etape.details, "tour") ?? "–")],
          ["Longueur", `${nombre(contenu.length)} caractères`],
        ]}
      />
      {usage && (
        <Section titre="Tokens de toute la conversation" note="tous les tours de l'agent">
          <JetonsLlm
            etape={{ modele }}
            tarifs={contexte.tarifs}
            usage={{ entree: lireNombre(usage, "entree") ?? 0, enCache: lireNombre(usage, "enCache") ?? 0, sortie: lireNombre(usage, "sortie") ?? 0, ecritCache: lireNombre(usage, "ecritCache") }}
          />
        </Section>
      )}
      <Section titre="Texte de la réponse">
        <div className="texte-rendu">
          <TexteRiche texte={contenu} />
        </div>
      </Section>
    </>
  );
}
