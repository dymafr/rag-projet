// Une fenêtre modale, sur l'élément <dialog> du navigateur : le focus y reste enfermé, Échap la ferme, le reste de la
// page devient inerte. À la fermeture, le focus revient là où il était
import { useEffect, useRef, type ReactNode } from "react";

type Proprietes = {
  onFermer: () => void;
  className?: string;
  titreId: string;
  children: ReactNode;
};

export function Dialogue({ onFermer, className, titreId, children }: Proprietes) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const precedent = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialogue = ref.current;
    if (dialogue && !dialogue.open) dialogue.showModal();
    return () => {
      dialogue?.close();
      // Le focus revient à l'élément qui a ouvert la fenêtre, s'il est encore dans la page
      if (precedent?.isConnected) precedent.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={className ? `dialogue ${className}` : "dialogue"}
      aria-labelledby={titreId}
      onCancel={(e) => {
        e.preventDefault();
        onFermer();
      }}
      onMouseDown={(e) => {
        // Un clic sur le voile (hors du contenu) ferme la fenêtre
        if (e.target === ref.current) onFermer();
      }}
    >
      <div className="dialogue-contenu">{children}</div>
    </dialog>
  );
}
