import fs from "node:fs/promises";
import path from "node:path";
import axios from "axios";
import { app, BrowserWindow, shell } from "electron";
import type { WorkshopInspection, WorkshopResult, WorkshopState } from "@types";
import { SevenZip } from "../7zip";
import { resolveWorkshopGame } from "./workshop-game";
import {
  WorkshopError,
  hasWorkshopDownloadSuccess,
  parseWorkshopDetails,
  parseWorkshopItemId,
  runSteamCommand,
  workshopDownloadArgs,
} from "./workshop-core";

const STEAMCMD_URL =
  "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip";
const DETAILS_URL =
  "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/";

class WorkshopService {
  private active: AbortController | null = null;
  private state: WorkshopState | null = null;

  private get root() {
    return path.join(app.getPath("userData"), "workshop", "steamcmd");
  }
  private get executable() {
    return path.join(this.root, "steamcmd.exe");
  }
  private get marker() {
    return path.join(this.root, "hydra-ready.json");
  }

  private async ensureState(): Promise<WorkshopState> {
    if (!this.state) {
      const installed = await Promise.all([
        fs.access(this.executable).then(
          () => true,
          () => false
        ),
        fs.access(this.marker).then(
          () => true,
          () => false
        ),
        fs.access(path.join(this.root, "steamclient.dll")).then(
          () => true,
          () => false
        ),
      ]).then((results) => results.every(Boolean));
      this.state ??= {
        revision: 0,
        supported: process.platform === "win32",
        installed,
        busy: false,
        phase: "idle",
        operation: null,
        item: null,
        game: null,
        contentPath: path.join(this.root, "steamapps", "workshop", "content"),
        downloadPath: null,
        error: null,
        logs: [],
      };
    }
    return this.state;
  }

  private update(patch: Partial<WorkshopState>) {
    if (!this.state) return;
    this.state = { ...this.state, ...patch, revision: this.state.revision + 1 };
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send("workshopStateChanged", this.state);
      }
    }
  }

  private log(text: string) {
    const lines = text
      .slice(-16 * 1024)
      .split(/\r?\n/)
      .filter(Boolean);
    this.update({ logs: [...(this.state?.logs ?? []), ...lines].slice(-200) });
  }

  public async getState(): Promise<WorkshopState> {
    return structuredClone(await this.ensureState());
  }

  private result(error?: WorkshopResult["error"]): WorkshopResult {
    return {
      success: !error,
      ...(error ? { error } : {}),
      state: structuredClone(this.state!),
    };
  }

  private async start(
    operation: "install" | "download",
    input?: unknown
  ): Promise<WorkshopResult> {
    const state = await this.ensureState();
    if (!state.supported) return this.result("unsupported");
    if (this.active) return this.result("busy");
    if (operation === "download" && !state.installed)
      return this.result("not-installed");
    let itemId: string | undefined;
    try {
      if (operation === "download") itemId = parseWorkshopItemId(input);
    } catch {
      return this.result("invalid-url");
    }
    const controller = new AbortController();
    this.active = controller;
    this.update({
      busy: true,
      phase: operation === "install" ? "installing" : "resolving",
      operation,
      item: null,
      game: null,
      error: null,
      logs: [],
      downloadPath: null,
    });
    void this.perform(operation, controller.signal, itemId)
      .catch((error) => {
        if (controller.signal.aborted) {
          this.update({ phase: "cancelled", error: null });
        } else {
          this.log(error instanceof Error ? error.message : String(error));
          this.update({
            phase: "failed",
            error:
              error instanceof WorkshopError
                ? error.code
                : operation === "install"
                  ? "install-failed"
                  : "download-failed",
          });
        }
      })
      .finally(() => {
        this.active = null;
        this.update({ busy: false });
      });
    return this.result();
  }

  private async perform(
    operation: "install" | "download",
    signal: AbortSignal,
    itemId?: string
  ) {
    if (operation === "install") {
      await fs.mkdir(this.root, { recursive: true });
      // A failed repair must never leave an old ready marker behind.
      this.update({ installed: false });
      await fs.rm(this.marker, { force: true });
      const archive = path.join(this.root, "steamcmd.zip");
      try {
        this.log("Downloading SteamCMD from Valve...");
        const response = await axios.get<ArrayBuffer>(STEAMCMD_URL, {
          responseType: "arraybuffer",
          signal,
          timeout: 60_000,
          maxContentLength: 32 * 1024 * 1024,
        });
        signal.throwIfAborted();
        await fs.writeFile(archive, Buffer.from(response.data));
        this.log("Extracting SteamCMD...");
        await SevenZip.extractFile({
          filePath: archive,
          outputPath: this.root,
        });
        signal.throwIfAborted();
        this.log(
          "Initializing SteamCMD. The first update may take a few minutes..."
        );
        await runSteamCommand({
          executable: this.executable,
          args: ["+quit"],
          cwd: this.root,
          signal,
          onLog: (text) => this.log(text),
          timeoutMs: 10 * 60_000,
          acceptedExitCodes: [0, 7],
        });
        signal.throwIfAborted();
        await fs.access(path.join(this.root, "steamclient.dll"));
        await fs.writeFile(
          this.marker,
          JSON.stringify({ installedAt: new Date().toISOString() })
        );
        this.update({ installed: true, phase: "completed" });
      } finally {
        await fs.rm(archive, { force: true }).catch(() => {});
      }
      return;
    }

    this.log(`Fetching Workshop item ${itemId} from Steam...`);
    const { item, game } = await this.inspect(itemId, signal);
    signal.throwIfAborted();
    this.update({ item, game, phase: "downloading" });
    this.log(`Detected game: ${game.name ?? "Steam App"} (App ${game.appId})`);
    if (game.location) this.log(`Game location: ${game.location.path}`);
    this.log(`${item.title} (App ${item.appId})`);
    const output = await runSteamCommand({
      executable: this.executable,
      args: workshopDownloadArgs(item),
      cwd: this.root,
      signal,
      onLog: (text) => this.log(text),
    });
    signal.throwIfAborted();
    if (!hasWorkshopDownloadSuccess(output, item.id))
      throw new WorkshopError("download-failed");
    const downloadPath = path.join(
      this.state!.contentPath,
      item.appId,
      item.id
    );
    const files = await fs.readdir(downloadPath);
    if (!files.length) throw new WorkshopError("download-failed");
    this.log(`Saved to ${downloadPath}`);
    this.update({ phase: "completed", downloadPath });
  }

  public async inspect(
    input: unknown,
    signal?: AbortSignal
  ): Promise<WorkshopInspection> {
    const itemId = parseWorkshopItemId(input);
    let data: unknown;
    try {
      const response = await axios.post(
        DETAILS_URL,
        new URLSearchParams({
          itemcount: "1",
          "publishedfileids[0]": itemId!,
        }).toString(),
        {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          signal,
          timeout: 30_000,
          maxContentLength: 2 * 1024 * 1024,
        }
      );
      data = response.data;
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new WorkshopError("network");
    }
    signal?.throwIfAborted();
    const item = parseWorkshopDetails(data, itemId);
    const game = await resolveWorkshopGame(item.appId, signal);
    signal?.throwIfAborted();
    return { item, game };
  }

  public install() {
    return this.start("install");
  }
  public download(input: unknown) {
    return this.start("download", input);
  }

  public async cancel(): Promise<WorkshopState> {
    await this.ensureState();
    if (this.active && !this.active.signal.aborted) {
      this.update({ phase: "cancelling" });
      this.active.abort(new Error("Cancelled"));
    }
    return this.getState();
  }

  public async openFolder(): Promise<string> {
    const state = await this.ensureState();
    const folder = state.downloadPath ?? state.contentPath;
    await fs.mkdir(folder, { recursive: true });
    return shell.openPath(folder);
  }
}

export const workshopService = new WorkshopService();
