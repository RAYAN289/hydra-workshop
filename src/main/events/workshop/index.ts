import { app } from "electron";
import { registerEvent } from "../register-event";
import { workshopService } from "../../services/workshop/workshop-service";

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

app.on("before-quit", () => {
  void workshopService.cancel();
});
