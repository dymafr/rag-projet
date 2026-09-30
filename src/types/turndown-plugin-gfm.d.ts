// Le paquet ne fournit pas ses types : on déclare ce qu'on en utilise
declare module "@joplin/turndown-plugin-gfm" {
  import type TurndownService from "turndown";
  export const tables: TurndownService.Plugin;
}
