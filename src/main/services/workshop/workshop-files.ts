import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  validateWorkshopAppId,
  validateWorkshopIds,
} from "./workshop-library-core.js";

export function workshopItemPath(root: string, appId: string, id: string) {
  validateWorkshopAppId(appId);
  validateWorkshopIds([id]);
  return path.join(root, appId, id);
}
export async function assertRegularWorkshopTree(directory: string) {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error("unsafe-folder");
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error("unsafe-folder");
    if (entry.isDirectory())
      await assertRegularWorkshopTree(path.join(directory, entry.name));
    else if (!entry.isFile()) throw new Error("unsafe-folder");
  }
}
export async function isManagedWorkshopInstall(
  directory: string,
  appId: string,
  id: string
) {
  try {
    if ((await fs.lstat(directory)).isSymbolicLink()) return false;
    const marker = JSON.parse(
      await fs.readFile(path.join(directory, ".hydra-workshop.json"), "utf8")
    );
    return marker.appId === appId && marker.id === id && marker.version === 1;
  } catch {
    return false;
  }
}
export async function copyWorkshopInstall(
  source: string,
  targetRoot: string,
  appId: string,
  id: string
) {
  validateWorkshopAppId(appId);
  validateWorkshopIds([id]);
  await assertRegularWorkshopTree(source);
  // Only a directory explicitly selected in the native folder picker is accepted.
  const root = await fs.realpath(targetRoot);
  if (!(await fs.stat(root)).isDirectory()) throw new Error("unsafe-folder");
  const destination = path.join(root, id);
  if (
    await fs.lstat(destination).then(
      () => true,
      () => false
    )
  ) {
    if (await isManagedWorkshopInstall(destination, appId, id))
      return destination;
    throw new Error("folder-conflict");
  }
  const temporary = path.join(root, `.hydra-workshop-${id}-${randomUUID()}`);
  try {
    await fs.cp(source, temporary, {
      recursive: true,
      force: false,
      errorOnExist: true,
      dereference: false,
    });
    await assertRegularWorkshopTree(temporary);
    await fs.writeFile(
      path.join(temporary, ".hydra-workshop.json"),
      JSON.stringify({ version: 1, appId, id })
    );
    // Do not overwrite a destination that appeared during the copy.
    if (
      await fs.lstat(destination).then(
        () => true,
        () => false
      )
    )
      throw new Error("folder-conflict");
    await fs.rename(temporary, destination);
    return destination;
  } finally {
    // This generated sibling is the only recursive cleanup target.
    if (
      path.dirname(temporary) === root &&
      path.basename(temporary).startsWith(`.hydra-workshop-${id}-`)
    )
      await fs.rm(temporary, { recursive: true, force: true });
  }
}
