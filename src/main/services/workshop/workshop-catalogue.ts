import axios from "axios";
import type { WorkshopCatalogueItem } from "@types";
import {
  parseCatalogueItem,
  parseSteamBrowse,
  validateWorkshopAppId,
  validateWorkshopIds,
} from "./workshop-library-core";

export async function browseWorkshop(input: {
  appId: string;
  search?: string;
  page?: number;
  sort?: string;
}) {
  const appId = validateWorkshopAppId(input?.appId);
  const page = Number(input.page ?? 1);
  if (!Number.isInteger(page) || page < 1 || page > 10000)
    throw new Error("invalid-page");
  const { data } = await axios.get<string>(
    "https://steamcommunity.com/workshop/browse/",
    {
      params: {
        appid: appId,
        searchtext: String(input.search ?? "").slice(0, 200),
        p: page,
        numperpage: 30,
        browsesort: ["trend", "mostrecent", "totaluniquesubscribers"].includes(
          input.sort ?? ""
        )
          ? input.sort
          : "trend",
        section: "readytouseitems",
        l: "english",
      },
      timeout: 30000,
      maxContentLength: 12 * 1024 * 1024,
      responseType: "text",
    }
  );
  return parseSteamBrowse(data, appId, page);
}

export async function getWorkshopItems(
  appId: string,
  ids: unknown
): Promise<WorkshopCatalogueItem[]> {
  validateWorkshopAppId(appId);
  const itemIds = validateWorkshopIds(ids);
  const body = new URLSearchParams({ itemcount: String(itemIds.length) });
  itemIds.forEach((id, index) => body.set(`publishedfileids[${index}]`, id));
  const { data } = await axios.post(
    "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/",
    body.toString(),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 30000,
      maxContentLength: 8 * 1024 * 1024,
    }
  );
  const items = (data?.response?.publishedfiledetails ?? [])
    .map((raw: Record<string, unknown>) => parseCatalogueItem(raw, appId))
    .filter(
      (item: WorkshopCatalogueItem | null): item is WorkshopCatalogueItem =>
        !!item
    );
  if (items.length !== itemIds.length) throw new Error("pack-unavailable");
  return items;
}
