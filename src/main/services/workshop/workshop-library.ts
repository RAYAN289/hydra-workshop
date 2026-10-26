import fs from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, clipboard, dialog, shell } from "electron";
import type { WorkshopLibraryState, WorkshopMod, WorkshopState } from "@types";
import { workshopService } from "./workshop-service";
import { getWorkshopItems } from "./workshop-catalogue";
import {
  createWorkshopPackLink,
  parseWorkshopPackLink,
  validateWorkshopAppId,
  validateWorkshopIds,
} from "./workshop-library-core";
import {
  assertRegularWorkshopTree,
  copyWorkshopInstall,
  isManagedWorkshopInstall,
  workshopItemPath,
} from "./workshop-files";

type StoredMod = WorkshopMod & {
  installationRoot?: string;
  externalRoot?: string;
};
class WorkshopLibrary {
  private mods: StoredMod[] = [];
  private targets: Record<string, string> = {};
  private initialized: Promise<void> | null = null;
  private saving: Promise<void> = Promise.resolve();
  private revision = 0;
  private activeId: string | null = null;
  private pumping = false;
  private cancelling = false;
  private get root() {
    return path.join(app.getPath("userData"), "workshop");
  }
  private get content() {
    return path.join(this.root, "steamcmd", "steamapps", "workshop", "content");
  }
  private async initialize() {
    this.initialized ??= (async () => {
      const raw = await fs
        .readFile(path.join(this.root, "library.json"), "utf8")
        .catch((error) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
      if (!raw) return;
      const stored = JSON.parse(raw);
      if (
        stored.version !== 1 ||
        !Array.isArray(stored.mods) ||
        !stored.targets ||
        typeof stored.targets !== "object"
      )
        throw new Error("library-invalid");
      this.mods = stored.mods;
      this.targets = stored.targets;
      for (const mod of this.mods) {
        validateWorkshopAppId(mod.item.appId);
        validateWorkshopIds([mod.item.id]);
        if (["queued", "downloading"].includes(mod.status)) {
          mod.status = "cancelled";
          mod.error = "interrupted";
        }
      }
    })();
    await this.initialized;
  }
  private snapshot(): WorkshopLibraryState {
    return {
      revision: this.revision,
      mods: this.mods.map(
        ({ installationRoot: _root, externalRoot: _external, ...mod }) =>
          structuredClone(mod)
      ),
      activeId: this.activeId,
      targets: { ...this.targets },
    };
  }
  private async changed() {
    this.revision++;
    const state = this.snapshot();
    for (const window of BrowserWindow.getAllWindows())
      if (!window.isDestroyed())
        window.webContents.send("workshopLibraryChanged", state);
    const data = JSON.stringify({
      version: 1,
      mods: this.mods,
      targets: this.targets,
    });
    const save = this.saving
      .catch(() => {})
      .then(async () => {
        await fs.mkdir(this.root, { recursive: true });
        const file = path.join(this.root, "library.json");
        await fs.writeFile(`${file}.tmp`, data);
        await fs.rename(`${file}.tmp`, file);
      });
    this.saving = save;
    await save;
  }
  public async getState() {
    await this.initialize();
    return this.snapshot();
  }
  public async enqueue(appId: string, ids: unknown) {
    await this.initialize();
    if (this.cancelling && this.pumping) throw new Error("busy");
    validateWorkshopAppId(appId);
    if (process.platform !== "win32") throw new Error("unsupported");
    const items = await getWorkshopItems(appId, ids);
    for (const item of items) {
      const existing = this.mods.find(
        (mod) => mod.item.appId === appId && mod.item.id === item.id
      );
      if (
        existing &&
        ["queued", "downloading", "installed"].includes(existing.status)
      )
        continue;
      if (existing) {
        existing.item = item;
        existing.status = "queued";
        existing.error = null;
      } else
        this.mods.push({
          item,
          status: "queued",
          error: null,
          updatedAt: Date.now(),
        });
    }
    await this.changed();
    void this.pump();
    return this.snapshot();
  }
  private async waitOperation(): Promise<WorkshopState> {
    for (;;) {
      const state = await workshopService.getState();
      if (!state.busy) return state;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    this.cancelling = false;
    try {
      for (;;) {
        const mod = this.mods.find((row) => row.status === "queued");
        if (!mod || this.cancelling) break;
        this.activeId = mod.item.id;
        mod.status = "downloading";
        await this.changed();
        try {
          const source = mod.externalRoot
            ? path.join(await fs.realpath(mod.externalRoot), mod.item.id)
            : workshopItemPath(this.content, mod.item.appId, mod.item.id);
          const ready = mod.externalRoot
            ? await fs.readdir(source).then(
                (files) => files.length > 0,
                () => false
              )
            : await workshopService.isDownloadComplete(
                mod.item.appId,
                mod.item.id
              );
          let runtime = await workshopService.getState();
          if (runtime.busy) throw new Error("busy");
          if (!ready && !runtime.installed) {
            const result = await workshopService.install();
            if (!result.success) throw new Error(result.error);
            runtime = await this.waitOperation();
            if (!runtime.installed)
              throw new Error(this.cancelling ? "cancelled" : "install-failed");
          }
          if (this.cancelling) throw new Error("cancelled");
          if (!ready) {
            if (mod.externalRoot) throw new Error("local-mod-missing");
            const result = await workshopService.download(mod.item.id);
            if (!result.success) throw new Error(result.error);
            runtime = await this.waitOperation();
            if (runtime.phase !== "completed")
              throw new Error(
                this.cancelling
                  ? "cancelled"
                  : (runtime.error ?? "download-failed")
              );
          }
          if (this.cancelling) throw new Error("cancelled");
          await assertRegularWorkshopTree(source);
          const target = this.targets[mod.item.appId];
          if (target) {
            await copyWorkshopInstall(
              source,
              target,
              mod.item.appId,
              mod.item.id
            );
            mod.installationRoot = target;
            mod.status = "installed";
          } else mod.status = "downloaded";
          mod.error = null;
        } catch (error) {
          mod.status = this.cancelling ? "cancelled" : "failed";
          mod.error =
            error instanceof Error ? error.message : "download-failed";
          if (mod.error === "install-failed")
            for (const pending of this.mods)
              if (pending.status === "queued") {
                pending.status = "failed";
                pending.error = "install-failed";
              }
        }
        mod.updatedAt = Date.now();
        this.activeId = null;
        await this.changed();
      }
    } catch {
      /* Persisted queued items remain retryable after a storage failure. */
    } finally {
      this.pumping = false;
      this.activeId = null;
      await this.changed().catch(() => {});
    }
  }
  public async cancel() {
    await this.initialize();
    this.cancelling = true;
    for (const mod of this.mods)
      if (mod.status === "queued") mod.status = "cancelled";
    await workshopService.cancel();
    await this.changed();
    return this.snapshot();
  }
  public async chooseTarget(appId: string) {
    await this.initialize();
    validateWorkshopAppId(appId);
    const result = await dialog.showOpenDialog({
      title: "Select this game's local mod / Workshop content folder",
      properties: ["openDirectory", "createDirectory"],
    });
    if (!result.canceled && result.filePaths[0]) {
      this.targets[appId] = await fs.realpath(result.filePaths[0]);
      await this.changed();
    }
    return this.snapshot();
  }
  public async importLocal(appId: string) {
    await this.initialize();
    validateWorkshopAppId(appId);
    const result = await dialog.showOpenDialog({
      title: "Select the Workshop folder containing numbered mod folders",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return this.snapshot();
    const root = await fs.realpath(result.filePaths[0]);
    const entries = (await fs.readdir(root, { withFileTypes: true })).filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        /^[1-9]\d{0,19}$/.test(entry.name)
    );
    if (!entries.length) throw new Error("no-local-mods");
    if (entries.length > 100) throw new Error("too-many-mods");
    const items = await getWorkshopItems(
      appId,
      entries.map((entry) => entry.name)
    );
    for (const item of items) {
      const source = path.join(root, item.id);
      await assertRegularWorkshopTree(source);
      if (!(await fs.readdir(source)).length) continue;
      if (
        this.mods.some(
          (mod) => mod.item.appId === appId && mod.item.id === item.id
        )
      )
        continue;
      this.mods.push({
        item,
        status: "downloaded",
        error: null,
        updatedAt: Date.now(),
        externalRoot: root,
      });
    }
    await this.changed();
    return this.snapshot();
  }
  public async share(appId: string, ids: unknown) {
    await this.initialize();
    const itemIds = validateWorkshopIds(ids);
    if (
      itemIds.some(
        (id) =>
          !this.mods.some(
            (mod) =>
              mod.item.appId === appId &&
              mod.item.id === id &&
              ["installed", "downloaded"].includes(mod.status)
          )
      )
    )
      throw new Error("share-not-downloaded");
    const link = createWorkshopPackLink(appId, itemIds);
    clipboard.writeText(link);
    return link;
  }
  public async inspectPack(link: unknown) {
    const pack = parseWorkshopPackLink(link);
    return { pack, items: await getWorkshopItems(pack.appId, pack.itemIds) };
  }
  public async openFolder(appId: string, id: string) {
    await this.initialize();
    validateWorkshopAppId(appId);
    validateWorkshopIds([id]);
    const mod = this.mods.find(
      (row) => row.item.appId === appId && row.item.id === id
    );
    const directory =
      mod?.status === "installed" && mod.installationRoot
        ? path.join(mod.installationRoot, id)
        : mod?.externalRoot
          ? path.join(await fs.realpath(mod.externalRoot), id)
          : workshopItemPath(this.content, appId, id);
    await assertRegularWorkshopTree(directory);
    return shell.openPath(directory);
  }
  public async remove(appId: string, id: string) {
    await this.initialize();
    validateWorkshopAppId(appId);
    validateWorkshopIds([id]);
    const mod = this.mods.find(
      (row) => row.item.appId === appId && row.item.id === id
    );
    if (!mod) return this.snapshot();
    if (["queued", "downloading"].includes(mod.status)) throw new Error("busy");
    if (mod.installationRoot) {
      const directory = path.join(await fs.realpath(mod.installationRoot), id);
      if (!(await isManagedWorkshopInstall(directory, appId, id)))
        throw new Error("folder-conflict");
      await assertRegularWorkshopTree(directory);
      await shell.trashItem(directory);
    }
    const cached = workshopItemPath(this.content, appId, id);
    if (
      await fs.lstat(cached).then(
        () => true,
        () => false
      )
    ) {
      await assertRegularWorkshopTree(cached);
      await shell.trashItem(cached);
    }
    this.mods = this.mods.filter((row) => row !== mod);
    await this.changed();
    return this.snapshot();
  }
}
export const workshopLibrary = new WorkshopLibrary();
