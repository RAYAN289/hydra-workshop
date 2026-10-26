import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { WorkshopErrorCode, WorkshopItem } from "@types";

export class WorkshopError extends Error {
  constructor(public readonly code: WorkshopErrorCode) {
    super(code);
  }
}

const ITEM_ID = /^[1-9]\d{0,19}$/;
const APP_ID = /^[1-9]\d{0,9}$/;

export function parseWorkshopItemId(input: unknown): string {
  if (typeof input !== "string" || input.length > 2048) {
    throw new WorkshopError("invalid-url");
  }
  const text = input.trim();
  if (ITEM_ID.test(text)) return text;
  try {
    const url = new URL(text);
    if (
      url.protocol !== "https:" ||
      !["steamcommunity.com", "www.steamcommunity.com"].includes(
        url.hostname
      ) ||
      url.port ||
      url.username ||
      url.password ||
      !/^\/(sharedfiles|workshop)\/filedetails\/?$/.test(url.pathname) ||
      url.searchParams.getAll("id").length !== 1
    )
      throw new Error("Invalid URL");
    const id = url.searchParams.get("id") ?? "";
    if (ITEM_ID.test(id)) return id;
  } catch {
    // Only Steam Community item URLs or numeric published file IDs are accepted.
  }
  throw new WorkshopError("invalid-url");
}

export function parseWorkshopDetails(
  payload: unknown,
  id: string
): WorkshopItem {
  const item = (
    payload as {
      response?: { publishedfiledetails?: Record<string, unknown>[] };
    }
  )?.response?.publishedfiledetails?.[0];
  if (!item || item.result !== 1 || String(item.publishedfileid) !== id) {
    throw new WorkshopError("unavailable");
  }
  if (item.file_type === 2) throw new WorkshopError("collection");
  const appId = String(item.consumer_app_id ?? "");
  if (!APP_ID.test(appId)) throw new WorkshopError("unavailable");
  return {
    id,
    appId,
    title: typeof item.title === "string" ? item.title.slice(0, 300) : id,
  };
}

export function workshopDownloadArgs(item: WorkshopItem): string[] {
  if (!ITEM_ID.test(item.id) || !APP_ID.test(item.appId)) {
    throw new WorkshopError("invalid-url");
  }
  return [
    "+login",
    "anonymous",
    "+workshop_download_item",
    item.appId,
    item.id,
    "validate",
    "+quit",
  ];
}

export function hasWorkshopDownloadSuccess(
  output: string,
  itemId: string
): boolean {
  return new RegExp(`Success\\.\\s+Downloaded item ${itemId}\\b`, "i").test(
    output
  );
}

export interface SteamCommandOptions {
  executable: string;
  args: string[];
  cwd: string;
  signal: AbortSignal;
  onLog: (text: string) => void;
  timeoutMs?: number;
  acceptedExitCodes?: number[];
}

/** Keep the full stream tail across chunks: SteamCMD can exit 0 after a failed item. */
export function runSteamCommand(options: SteamCommandOptions): Promise<string> {
  options.signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(options.executable, options.args, {
      cwd: options.cwd,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const decoders = [new StringDecoder("utf8"), new StringDecoder("utf8")];
    const output = ["", ""];
    let timedOut = false;
    let settled = false;
    const append = (text: string, stream: number) => {
      if (!text) return;
      output[stream] = (output[stream] + text).slice(-128 * 1024);
      // eslint-disable-next-line no-control-regex -- Strip terminal ANSI escapes from the UI log.
      options.onLog(text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, ""));
    };
    child.stdout.on("data", (chunk) => append(decoders[0].write(chunk), 0));
    child.stderr.on("data", (chunk) => append(decoders[1].write(chunk), 1));
    const abort = () => {
      child.kill();
    };
    const timer = setTimeout(
      () => {
        timedOut = true;
        child.kill();
      },
      options.timeoutMs ?? 60 * 60 * 1000
    );
    const finish = (error?: Error, code?: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal.removeEventListener("abort", abort);
      append(decoders[0].end(), 0);
      append(decoders[1].end(), 1);
      if (options.signal.aborted) reject(options.signal.reason);
      else if (error) reject(error);
      else if (timedOut) reject(new Error("SteamCMD timed out"));
      else if (!(options.acceptedExitCodes ?? [0]).includes(code ?? -1)) {
        reject(new Error(`SteamCMD exited with code ${code}`));
      } else resolve(output.filter(Boolean).join("\n"));
    };
    child.once("error", (error) => finish(error));
    child.once("close", (code) => finish(undefined, code));
    options.signal.addEventListener("abort", abort, { once: true });
    if (options.signal.aborted) abort();
  });
}
