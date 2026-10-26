import { registerEvent } from "../register-event";
import { workshopService } from "../../services/workshop/workshop-service";
import { workshopLibrary } from "../../services/workshop/workshop-library";
import { browseWorkshop } from "../../services/workshop/workshop-catalogue";
import { gamesSublevel } from "../../level/sublevels/games";
import { getSteamLibraryFolders } from "../../services/steam";
import { listInstalledSteamApps } from "../../services/steam-integration/steam-installation-core";

registerEvent("getWorkshopGames", async () => {
  const [library, steam] = await Promise.all([
    gamesSublevel.values().all(),
    getSteamLibraryFolders()
      .then(listInstalledSteamApps)
      .catch(() => []),
  ]);
  const games = new Map<string, string>();
  for (const game of library) {
    if (game.isDeleted) continue;
    const identity =
      game.catalogueGame?.shop === "steam" ? game.catalogueGame : game;
    if (identity.shop === "steam" && /^[1-9]\d{0,9}$/.test(identity.objectId))
      games.set(identity.objectId, game.title);
  }
  for (const game of steam)
    if (!games.has(game.appId))
      games.set(game.appId, game.name ?? `Steam App ${game.appId}`);
  return [...games]
    .map(([appId, name]) => ({ appId, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
});

registerEvent("browseWorkshop", (_event, input) => browseWorkshop(input));
registerEvent("getWorkshopLibrary", () => workshopLibrary.getState());
registerEvent("importLocalWorkshopMods", (_event, appId: string) =>
  workshopLibrary.importLocal(appId)
);
registerEvent("enqueueWorkshopItems", (_event, appId: string, ids: unknown) =>
  workshopLibrary.enqueue(appId, ids)
);
registerEvent("cancelWorkshopQueue", () => workshopLibrary.cancel());
registerEvent("chooseWorkshopTarget", (_event, appId: string) =>
  workshopLibrary.chooseTarget(appId)
);
registerEvent("shareWorkshopPack", (_event, appId: string, ids: unknown) =>
  workshopLibrary.share(appId, ids)
);
registerEvent("inspectWorkshopPack", (_event, link: unknown) =>
  workshopLibrary.inspectPack(link)
);
registerEvent("openWorkshopItemFolder", (_event, appId: string, id: string) =>
  workshopLibrary.openFolder(appId, id)
);
registerEvent("removeWorkshopItem", (_event, appId: string, id: string) =>
  workshopLibrary.remove(appId, id)
);

registerEvent("getWorkshopState", () => workshopService.getState());
registerEvent("inspectWorkshopItem", async (_event, input: unknown) => {
  try {
    return await workshopService.inspect(input);
  } catch {
    // Typing an incomplete link should not interrupt the form or its downloads.
    return null;
  }
});
registerEvent("installWorkshopSteamCMD", () => workshopService.install());
registerEvent("downloadWorkshopItem", (_event, input: unknown) =>
  workshopService.download(input)
);
registerEvent("cancelWorkshopOperation", () => workshopService.cancel());
registerEvent("openWorkshopFolder", () => workshopService.openFolder());
