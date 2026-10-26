import { JSDOM } from "jsdom";
import type {
  WorkshopBrowseResult,
  WorkshopCatalogueItem,
  WorkshopPack,
} from "@types";

export const validateWorkshopAppId = (input: unknown): string => {
  if (typeof input !== "string" || !/^[1-9]\d{0,9}$/.test(input))
    throw new Error("invalid-app");
  return input;
};
export const validateWorkshopIds = (input: unknown): string[] => {
  if (
    !Array.isArray(input) ||
    input.length < 1 ||
    input.length > 100 ||
    input.some((id) => typeof id !== "string" || !/^[1-9]\d{0,19}$/.test(id))
  )
    throw new Error("invalid-pack");
  return [...new Set(input)];
};
export function parseCatalogueItem(
  raw: Record<string, unknown>,
  appId: string
): WorkshopCatalogueItem | null {
  const id = String(raw.publishedfileid ?? "");
  const consumer = String(raw.consumer_appid ?? raw.consumer_app_id ?? "");
  if (
    !/^[1-9]\d{0,19}$/.test(id) ||
    consumer !== appId ||
    (raw.file_type !== undefined && raw.file_type !== 0) ||
    (raw.result !== undefined && raw.result !== 1)
  )
    return null;
  let previewUrl: string | null = null;
  try {
    const url = new URL(String(raw.preview_url));
    if (
      url.protocol === "https:" &&
      /(^|\.)(steamusercontent\.com|steamstatic\.com|akamai\.steamstatic\.com)$/.test(
        url.hostname
      )
    )
      previewUrl = url.toString();
  } catch {
    /* Optional Steam artwork. */
  }
  const size = Number(raw.file_size);
  return {
    id,
    appId,
    title: String(raw.title ?? id).slice(0, 300),
    description: String(raw.short_description ?? raw.description ?? "")
      .replace(/\[\/?[^\]]+\]/g, "")
      .slice(0, 1200),
    previewUrl,
    size: Number.isSafeInteger(size) && size >= 0 ? size : 0,
    updatedAt: Number(raw.time_updated) || 0,
  };
}

export function parseSteamBrowse(
  html: string,
  appId: string,
  page: number
): WorkshopBrowseResult {
  const dom = new JSDOM(html); // No scripts or subresources are executed or fetched.
  try {
    const script = dom.window.document.querySelector("#valve-ssr-data");
    if (!script?.textContent) throw new Error("catalogue-format");
    const ssr = JSON.parse(script.textContent);
    const cache = JSON.parse(ssr.renderContext?.queryData ?? "{}");
    const query = cache.queries?.find(
      (entry: { state?: { data?: { results?: unknown[] } } }) =>
        Array.isArray(entry.state?.data?.results)
    );
    const data = query?.state?.data;
    if (!data) return { items: [], total: 0, page, hasMore: false };
    if (data.eresult !== 1) throw new Error("unavailable");
    const items = (data.results as Record<string, unknown>[])
      .map((raw) => parseCatalogueItem(raw, appId))
      .filter((item): item is WorkshopCatalogueItem => !!item);
    const total = Math.max(0, Number(data.total_count) || 0);
    return {
      items,
      total: items.length ? total : 0,
      page,
      hasMore: items.length > 0 && page < Number(data.total_pages),
    };
  } finally {
    dom.window.close();
  }
}

export function createWorkshopPackLink(appId: string, ids: unknown): string {
  const query = new URLSearchParams({
    v: "1",
    appId: validateWorkshopAppId(appId),
    items: validateWorkshopIds(ids).join(","),
  });
  return `hydralauncher-workshop://workshop?${query}`;
}
export function parseWorkshopPackLink(input: unknown): WorkshopPack {
  if (typeof input !== "string" || input.length > 5000)
    throw new Error("invalid-pack");
  const url = new URL(input.trim());
  if (
    url.protocol !== "hydralauncher-workshop:" ||
    url.hostname !== "workshop" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    !["", "/"].includes(url.pathname)
  )
    throw new Error("invalid-pack");
  for (const key of ["v", "appId", "items"])
    if (url.searchParams.getAll(key).length !== 1)
      throw new Error("invalid-pack");
  if (
    url.searchParams.get("v") !== "1" ||
    [...url.searchParams.keys()].some(
      (key) => !["v", "appId", "items"].includes(key)
    )
  )
    throw new Error("invalid-pack");
  return {
    version: 1,
    appId: validateWorkshopAppId(url.searchParams.get("appId")),
    itemIds: validateWorkshopIds(url.searchParams.get("items")?.split(",")),
  };
}
