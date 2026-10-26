import assert from "node:assert/strict";
import { describe, it } from "node:test";
// @ts-ignore Node's ESM test runner requires the source extension.
import {
  WorkshopError,
  parseWorkshopItemId,
  parseWorkshopDetails,
  workshopDownloadArgs,
  hasWorkshopDownloadSuccess,
  runSteamCommand,
} from "./workshop-core.ts";

const id = "2996273695";
const item = { id, appId: "1637320", title: "Example mod" };
const details = (extra: Record<string, unknown> = {}) => ({
  response: {
    publishedfiledetails: [
      {
        result: 1,
        publishedfileid: id,
        consumer_app_id: 1637320,
        title: item.title,
        file_type: 0,
        ...extra,
      },
    ],
  },
});
const errorCode = (code: string) => (error: unknown) =>
  error instanceof WorkshopError && error.code === code;

describe("Workshop input and Steam metadata", () => {
  it("accepts item links, alternate Workshop paths and IDs without losing large-ID precision", () => {
    for (const input of [
      id,
      `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`,
      `https://www.steamcommunity.com/workshop/filedetails/?id=${id}&searchtext=`,
      `  ${id}  `,
    ]) {
      assert.equal(parseWorkshopItemId(input), id);
    }
    assert.equal(
      parseWorkshopItemId("18446744073709551615"),
      "18446744073709551615"
    );
  });
  it("rejects foreign hosts, credentials, duplicate IDs, commands and non-item URLs", () => {
    for (const input of [
      null,
      {},
      "",
      "0",
      "-123",
      "123;calc",
      "+quit",
      "https://evil.test/?id=123",
      "https://steamcommunity.com.evil.test/sharedfiles/filedetails/?id=123",
      "http://steamcommunity.com/sharedfiles/filedetails/?id=123",
      "https://user@steamcommunity.com/sharedfiles/filedetails/?id=123",
      "https://steamcommunity.com:444/sharedfiles/filedetails/?id=123",
      "https://steamcommunity.com/sharedfiles/filedetails/?id=123&id=456",
      "https://steamcommunity.com/sharedfiles/filedetails/?id=123%26%2Bquit",
      "https://steamcommunity.com/workshop/browse/?id=123",
      "1".repeat(2049),
    ]) {
      assert.throws(() => parseWorkshopItemId(input), errorCode("invalid-url"));
    }
  });
  it("uses the consumer app ID and only accepts a successful, matching item", () => {
    assert.deepEqual(parseWorkshopDetails(details(), id), item);
    for (const invalid of [
      null,
      {},
      details({ result: 9 }),
      details({ publishedfileid: "123" }),
      details({ consumer_app_id: "../../123" }),
      details({ consumer_app_id: 0 }),
    ]) {
      assert.throws(
        () => parseWorkshopDetails(invalid, id),
        errorCode("unavailable")
      );
    }
  });
  it("identifies collection links instead of reporting a misleading download failure", () => {
    assert.throws(
      () => parseWorkshopDetails(details({ file_type: 2 }), id),
      errorCode("collection")
    );
  });
  it("constructs isolated process arguments and rejects injected metadata", () => {
    assert.deepEqual(workshopDownloadArgs(item), [
      "+login",
      "anonymous",
      "+workshop_download_item",
      item.appId,
      id,
      "validate",
      "+quit",
    ]);
    assert.throws(
      () => workshopDownloadArgs({ ...item, appId: "123 +quit" }),
      errorCode("invalid-url")
    );
  });
  it("requires a success line for the requested item, not just exit code zero", () => {
    assert.equal(
      hasWorkshopDownloadSuccess(
        `Success. Downloaded item ${id} to content`,
        id
      ),
      true
    );
    for (const output of [
      "ERROR! Download item 2996273695 failed (Failure).",
      "Success. Downloaded item 29962736950",
      "Success. Downloaded item 123",
      "Logging off...",
    ]) {
      assert.equal(hasWorkshopDownloadSuccess(output, id), false);
    }
  });
});

describe("SteamCMD process lifecycle (real child processes)", () => {
  const run = (
    script: string,
    extra: Partial<Parameters<typeof runSteamCommand>[0]> = {}
  ) =>
    runSteamCommand({
      executable: process.execPath,
      args: ["-e", script],
      cwd: process.cwd(),
      signal: new AbortController().signal,
      onLog: () => {},
      ...extra,
    });
  it("retains output split across stdout chunks and stderr", async () => {
    const logs: string[] = [];
    const output = await run(
      `process.stdout.write('Success. Down'); setTimeout(() => { process.stdout.write('loaded item ${id}'); process.stderr.write('stderr log'); }, 20);`,
      { onLog: (text) => logs.push(text) }
    );
    assert.equal(hasWorkshopDownloadSuccess(output, id), true);
    assert.match(output, /stderr log/);
    assert.ok(logs.length >= 2);
  });
  it("rejects a failing process and accepts bootstrap exit 7 only when explicitly allowed", async () => {
    await assert.rejects(run("process.exit(7)"), /code 7/);
    assert.equal(
      await run("process.exit(7)", { acceptedExitCodes: [0, 7] }),
      ""
    );
  });
  it("reports failure to start without hanging", async () => {
    await assert.rejects(
      run("", { executable: "missing-hydra-steamcmd-test-executable.exe" }),
      /ENOENT/
    );
  });
  it("cancels the child and waits for it to stop", async () => {
    const controller = new AbortController();
    const promise = run("setInterval(() => {}, 1000)", {
      signal: controller.signal,
    });
    controller.abort(new Error("Test cancellation"));
    await assert.rejects(promise, /Test cancellation/);
  });
  it("terminates stalled processes", async () => {
    await assert.rejects(
      run("setInterval(() => {}, 1000)", { timeoutMs: 100 }),
      /timed out/
    );
  });
  it("bounds retained output", async () => {
    const output = await run("process.stdout.write('x'.repeat(200000))");
    assert.equal(output.length, 128 * 1024);
  });
});
