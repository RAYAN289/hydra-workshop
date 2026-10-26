import axios from "axios";
import { gamesSublevel } from "../../level/sublevels/games";
import { getSteamLibraryFolders } from "../steam";
import { findInstalledSteamApp } from "../steam-integration/steam-installation-core";
import { identifyWorkshopGame } from "./workshop-game-core";

export function resolveWorkshopGame(appId: string, signal?: AbortSignal) {
  return identifyWorkshopGame(appId, {
    library: () => gamesSublevel.values().all(),
    steamInstallation: async () =>
      findInstalledSteamApp(appId, await getSteamLibraryFolders()),
    storeName: async () => {
      const { data } = await axios.get(
        "https://store.steampowered.com/api/appdetails",
        {
          params: { appids: appId, filters: "basic", l: "english" },
          signal,
          timeout: 8_000,
          maxContentLength: 2 * 1024 * 1024,
        }
      );
      const name = data?.[appId]?.success && data[appId].data?.name;
      return typeof name === "string" ? name.slice(0, 300) : null;
    },
  });
}
