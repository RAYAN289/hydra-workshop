import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { it } from "node:test";
import {
  assertRegularWorkshopTree,
  copyWorkshopInstall,
  isManagedWorkshopInstall,
  workshopItemPath,
} from "./workshop-files.ts";

it("copies into an owned item subfolder and preserves unrelated destination files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-workshop-copy-"));
  try {
    const source = path.join(root, "download"),
      target = path.join(root, "mods");
    await fs.mkdir(source);
    await fs.mkdir(target);
    await fs.writeFile(path.join(source, "theme.json"), '{"title":"Test"}');
    await fs.writeFile(path.join(target, "keep.txt"), "original");
    const destination = await copyWorkshopInstall(
      source,
      target,
      "5053820",
      "1234"
    );
    assert.equal(
      await isManagedWorkshopInstall(destination, "5053820", "1234"),
      true
    );
    assert.equal(
      await fs.readFile(path.join(target, "keep.txt"), "utf8"),
      "original"
    );
    assert.equal(
      await copyWorkshopInstall(source, target, "5053820", "1234"),
      destination
    );
    const foreign = path.join(target, "5678");
    await fs.mkdir(foreign);
    await fs.writeFile(path.join(foreign, "keep"), "do not overwrite");
    await assert.rejects(
      copyWorkshopInstall(source, target, "5053820", "5678"),
      /folder-conflict/
    );
    assert.equal(
      await fs.readFile(path.join(foreign, "keep"), "utf8"),
      "do not overwrite"
    );
    assert.throws(() => workshopItemPath(target, "../escape", "1234"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
it("refuses symlinks and junctions rather than copying files outside a mod", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "hydra-workshop-links-")
  );
  try {
    const source = path.join(root, "source"),
      outside = path.join(root, "outside");
    await fs.mkdir(source);
    await fs.mkdir(outside);
    await fs.symlink(
      outside,
      path.join(source, "link"),
      process.platform === "win32" ? "junction" : "dir"
    );
    await assert.rejects(assertRegularWorkshopTree(source), /unsafe-folder/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
