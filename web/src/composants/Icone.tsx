// Les icônes de l'interface : des tracés SVG dessinés pour elle, sur une grille de 24, en trait de la couleur du texte
const CERCLE = "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z";

const TRACES = {
  conversation: ["M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7.5a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5v-3.5A2 2 0 0 1 4 14.5z"],
  recherche: ["M10.5 17.5a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "M20 20l-4.5-4.5"],
  index: ["M12 3.5l8.5 4.5-8.5 4.5L3.5 8z", "M3.5 12.5l8.5 4.5 8.5-4.5", "M3.5 16.5l8.5 4.5 8.5-4.5"],
  evaluations: ["M9 3.5h6v3H9z", "M8 5H6.5A1.5 1.5 0 0 0 5 6.5v13A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-13A1.5 1.5 0 0 0 17.5 5H16", "M9 14l2 2 4-4.5"],
  configuration: ["M4 7h9", "M17 7h3", "M4 17h3", "M11 17h9", "M15 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", "M9 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"],
  soleil: ["M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M12 2.5v2", "M12 19.5v2", "M4.6 4.6L6 6", "M18 18l1.4 1.4", "M2.5 12h2", "M19.5 12h2", "M4.6 19.4L6 18", "M18 6l1.4-1.4"],
  lune: ["M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5z"],
  ecran: ["M3.5 5h17v11h-17z", "M9 20h6", "M12 16v4"],
  utilisateur: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M4.5 20.5a7.5 7.5 0 0 1 15 0"],
  "chevron-droite": ["M9.5 6l6 6-6 6"],
  "chevron-gauche": ["M14.5 6l-6 6 6 6"],
  "chevron-bas": ["M6 9.5l6 6 6-6"],
  "chevron-haut": ["M6 14.5l6-6 6 6"],
  copier: ["M9 9h10.5v10.5H9z", "M5 15V4.5h10.5"],
  coche: ["M5 12.5l4.5 4.5L19 7.5"],
  croix: ["M6.5 6.5l11 11", "M17.5 6.5l-11 11"],
  stop: ["M7.5 7.5h9v9h-9z"],
  envoyer: ["M12 19V5.5", "M6.5 11L12 5.5 17.5 11"],
  plus: ["M12 5v14", "M5 12h14"],
  alerte: ["M12 4l9 16H3z", "M12 10v4", "M12 17h.01"],
  info: [CERCLE, "M12 11v5", "M12 8h.01"],
  horloge: [CERCLE, "M12 7v5l3.5 2"],
  piece: [CERCLE, "M14.5 9.2c-.4-.9-1.3-1.4-2.5-1.4-1.5 0-2.5.8-2.5 1.9 0 2.6 5.2 1.4 5.2 4.2 0 1.1-1.1 2-2.7 2-1.3 0-2.3-.6-2.7-1.5", "M12 6v1.8", "M12 16.2V18"],
  puce: ["M7 7h10v10H7z", "M10 10h4v4h-4z", "M9.5 3v4", "M14.5 3v4", "M9.5 17v4", "M14.5 17v4", "M3 9.5h4", "M3 14.5h4", "M17 9.5h4", "M17 14.5h4"],
  outil: ["M14.7 6.3a4 4 0 0 0 5 5L11 20a2.1 2.1 0 0 1-3-3l8.7-8.7a4 4 0 0 1-2-2z", "M14.7 6.3L17 4l3 3-2.3 2.3"],
  fusion: ["M6 7v10", "M6 7c0 5 5 5 10 5", "M6 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", "M6 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", "M18 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"],
  filtre: ["M4 5h16l-6 7.5V19l-4 1.5v-8z"],
  "filtre-barre": ["M4 5h16l-6 7.5V19l-4 1.5v-8z", "M3 3l18 18"],
  bouclier: ["M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"],
  jauge: ["M4 16.5a8 8 0 1 1 16 0", "M12 16.5l4-5", "M12 16.5h.01"],
  pile: ["M4 6.5h16v4H4z", "M4 13.5h10v4H4z"],
  citation: ["M10 7H6.5a1.5 1.5 0 0 0-1.5 1.5V12h4.5v.5A3.5 3.5 0 0 1 6 16", "M19 7h-3.5a1.5 1.5 0 0 0-1.5 1.5V12h4.5v.5A3.5 3.5 0 0 1 15 16"],
  document: ["M6.5 3h8l5 5v13h-13z", "M14.5 3v5h5", "M9.5 13h6", "M9.5 17h4"],
  "fleche-haut": ["M12 19V5", "M6.5 10.5L12 5l5.5 5.5"],
  "fleche-bas": ["M12 5v14", "M6.5 13.5L12 19l5.5-5.5"],
  "fleche-droite": ["M5 12h14", "M13 6l6 6-6 6"],
  retour: ["M19 12H5", "M11 6l-6 6 6 6"],
  erreur: [CERCLE, "M9 9l6 6", "M15 9l-6 6"],
  ok: [CERCLE, "M8.5 12.5l2.5 2.5 4.5-5"],
  vecteur: ["M4 4v16h16", "M4 20L15 9", "M10 9h5v5"],
  base: ["M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3z", "M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5", "M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"],
  etendre: ["M14.5 4H20v5.5", "M9.5 20H4v-5.5", "M20 4l-6.5 6.5", "M4 20l6.5-6.5"],
  reduire: ["M4 14h6v6", "M20 10h-6V4", "M14 10l6.5-6.5", "M3.5 20.5L10 14"],
  clavier: ["M3 6h18v12H3z", "M7 10h.01", "M11 10h.01", "M15 10h.01", "M17 10h.01", "M7 14h10"],
  calendrier: ["M4 6h16v15H4z", "M4 10h16", "M8 3v4", "M16 3v4"],
  cadenas: ["M6 11h12v10H6z", "M8.5 11V8a3.5 3.5 0 0 1 7 0v3"],
  globe: [CERCLE, "M3 12h18", "M12 3c2.4 2.5 3.5 5.5 3.5 9s-1.1 6.5-3.5 9c-2.4-2.5-3.5-5.5-3.5-9S9.6 5.5 12 3z"],
  machine: ["M5 5h14v10H5z", "M3 19h18"],
  boucle: ["M4.5 11a7.5 7.5 0 0 1 13.4-4.2L20 9", "M20 4v5h-5", "M19.5 13a7.5 7.5 0 0 1-13.4 4.2L4 15", "M4 20v-5h5"],
  drapeau: ["M5 21V4", "M5 4h11.5l-2 4 2 4H5"],
  texte: ["M4 6h16", "M4 10h16", "M4 14h11", "M4 18h7"],
  liste: ["M9 6h11", "M9 12h11", "M9 18h11", "M4.5 6h.01", "M4.5 12h.01", "M4.5 18h.01"],
  question: [CERCLE, "M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4V14", "M12 17h.01"],
  interdit: [CERCLE, "M5.7 5.7l12.6 12.6"],
  eclair: ["M13 3L5 13.5h6L10 21l8-10.5h-6z"],
  comparer: ["M7 7.5h13", "M16 3.5l4 4-4 4", "M17 16.5H4", "M8 12.5l-4 4 4 4"],
  tri: ["M8 4v16", "M4.5 7.5L8 4l3.5 3.5", "M16 20V4", "M12.5 16.5L16 20l3.5-3.5"],
  etincelle: ["M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z", "M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"],
  attente: ["M12 3a9 9 0 1 0 9 9"],
  point: ["M12 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"],
  json: ["M8 4H7a2 2 0 0 0-2 2v3.5c0 1.1-.9 2-2 2.5 1.1.5 2 1.4 2 2.5V18a2 2 0 0 0 2 2h1", "M16 4h1a2 2 0 0 1 2 2v3.5c0 1.1.9 2 2 2.5-1.1.5-2 1.4-2 2.5V18a2 2 0 0 1-2 2h-1"],
  relais: ["M3 12h8", "M8 8.5L11.5 12 8 15.5", "M14.5 5.5h6v13h-6z"],
  pouce: ["M7 10.5V20H4.5a1 1 0 0 1-1-1v-7.5a1 1 0 0 1 1-1z", "M7 10.5l3.6-6.3a1.6 1.6 0 0 1 2.9 1.2L12.8 9h5.6a2 2 0 0 1 2 2.4l-1.3 6.8a2 2 0 0 1-2 1.8H7"],
  coeur: ["M12 20s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10z"],
  activite: ["M3 12h4l3-7 4 14 3-7h4"],
  lien: ["M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1", "M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"],
} as const;

export type NomIcone = keyof typeof TRACES;

type Proprietes = { nom: NomIcone; taille?: number; className?: string; titre?: string };

export function Icone({ nom, taille = 16, className, titre }: Proprietes) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={taille}
      height={taille}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ? `icone ${className}` : "icone"}
      aria-hidden={titre ? undefined : true}
      role={titre ? "img" : undefined}
      aria-label={titre}
      focusable="false"
    >
      {TRACES[nom].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
