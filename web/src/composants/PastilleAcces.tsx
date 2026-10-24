// Le niveau d'accès d'un document ou d'un passage (chapitre 13) : tous, manager, rh
import { Pastille, type Ton } from "./elements.tsx";

const TONS: Record<string, Ton> = { tous: "neutre", manager: "info", rh: "alerte" };
const LIBELLES: Record<string, string> = { tous: "tous", manager: "managers", rh: "service RH" };

export function PastilleAcces({ acces }: { acces: string }) {
  return (
    <Pastille ton={TONS[acces] ?? "neutre"} icone={acces === "tous" ? undefined : "cadenas"} titre={`Niveau d'accès\u00a0: ${acces}`}>
      {LIBELLES[acces] ?? acces}
    </Pastille>
  );
}
