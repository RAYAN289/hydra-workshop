import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import {
  identifyWorkshopGame,
  matchesWorkshopGame,
  type WorkshopLibraryGame,
} from "./workshop-game-core.ts";

const game: WorkshopLibraryGame = {
  shop: "steam",
  objectId: "5053820",
  title: "Mimic Party",
  isDeleted: false,
};
const noSteam = async () => null;

it("matches Steam IDs and explicit catalogue links, never names or another store's numeric ID", () => {
  assert.equal(matchesWorkshopGame(game, "5053820"), true);
  assert.equal(
    matchesWorkshopGame({ ...game, objectId: "42" }, "5053820"),
    false
  );
  assert.equal(
    matchesWorkshopGame({ ...game, shop: "epic" }, "5053820"),
    false
  );
  assert.equal(
    matchesWorkshopGame({ ...game, isDeleted: true }, "5053820"),
    false
  );
  assert.equal(
    matchesWorkshopGame(
      {
        ...game,
        shop: "custom",
        objectId: "local-game",
        catalogueGame: { shop: "steam", objectId: "5053820" },
      },
      "5053820"
    ),
    true
  );
});

it("detects a Steam installation even when the game is absent from Hydra", async () => {
  const result = await identifyWorkshopGame("5053820", {
    library: async () => [],
    steamInstallation: async () => ({
      name: "Mimic Party",
      installDirectory: "/steam/common/Mimic Party",
    }),
    storeName: async () => {
      throw new Error("Must not request the store");
    },
  });
  assert.equal(result.name, "Mimic Party");
  assert.equal(result.inHydraLibrary, false);
  assert.deepEqual(result.location, {
    kind: "steam-install",
    path: "/steam/common/Mimic Party",
  });
});

it("validates Hydra executables and labels their directory without guessing the game root", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-workshop-"));
  try {
    const bin = path.join(temp, "bin");
    await fs.mkdir(bin);
    const executablePath = path.join(bin, "game.exe");
    await fs.writeFile(executablePath, "test fixture");
    const result = await identifyWorkshopGame("5053820", {
      library: async () => [
        { ...game, executablePath: path.join(temp, "missing.exe") },
        { ...game, executablePath },
      ],
      steamInstallation: noSteam,
      storeName: noSteam,
    });
    assert.equal(result.inHydraLibrary, true);
    assert.deepEqual(result.location, { kind: "hydra-executable", path: bin });
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

it("keeps the authoritative app ID when library, Steam or store lookup is unavailable", async () => {
  const unavailable = async (): Promise<never> => {
    throw new Error("offline");
  };
  assert.deepEqual(
    await identifyWorkshopGame("294100", {
      library: unavailable,
      steamInstallation: unavailable,
      storeName: unavailable,
    }),
    { appId: "294100", name: null, inHydraLibrary: false, location: null }
  );
});

it("uses Steam store naming when the game is not installed", async () => {
  const result = await identifyWorkshopGame("294100", {
    library: async () => [],
    steamInstallation: noSteam,
    storeName: async () => "RimWorld",
  });
  assert.equal(result.name, "RimWorld");
  assert.equal(result.location, null);
});
