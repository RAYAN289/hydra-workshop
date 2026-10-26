import fs from "node:fs/promises";
import path from "node:path";
import type { Game, WorkshopGame } from "@types";

export type WorkshopLibraryGame = Pick<
  Game,
  | "shop"
  | "objectId"
  | "catalogueGame"
  | "isDeleted"
  | "title"
  | "executablePath"
>;

export function matchesWorkshopGame(game: WorkshopLibraryGame, appId: string) {
  if (game.isDeleted) return false;
  return (
    (game.shop === "steam" && game.objectId === appId) ||
    (game.catalogueGame?.shop === "steam" &&
      game.catalogueGame.objectId === appId)
  );
}

export async function identifyWorkshopGame(
  appId: string,
  dependencies: {
    library: () => Promise<WorkshopLibraryGame[]>;
    steamInstallation: () => Promise<{
      name: string | null;
      installDirectory: string;
    } | null>;
    storeName: () => Promise<string | null>;
  }
): Promise<WorkshopGame> {
  const [games, steam] = await Promise.all([
    dependencies.library().catch(() => []),
    dependencies.steamInstallation().catch(() => null),
  ]);
  const matches = games.filter((game) => matchesWorkshopGame(game, appId));
  const result: WorkshopGame = {
    appId,
    name: steam?.name || matches.find((game) => game.title)?.title || null,
    inHydraLibrary: matches.length > 0,
    location: steam
      ? { path: steam.installDirectory, kind: "steam-install" }
      : null,
  };

  if (!result.location) {
    for (const game of matches) {
      // An executable can live in a bin subfolder: do not call it the install root.
      if (!game.executablePath || !path.isAbsolute(game.executablePath))
        continue;
      const exists = await fs
        .stat(game.executablePath)
        .then((stats) => stats.isFile())
        .catch(() => false);
      if (exists) {
        result.location = {
          path: path.dirname(game.executablePath),
          kind: "hydra-executable",
        };
        break;
      }
    }
  }
  if (!result.name) {
    result.name = await dependencies.storeName().catch(() => null);
  }
  return result;
}
