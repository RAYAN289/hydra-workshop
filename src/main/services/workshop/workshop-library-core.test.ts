import assert from "node:assert/strict";
import { it } from "node:test";
import {
  createWorkshopPackLink,
  parseWorkshopPackLink,
  parseCatalogueItem,
  parseSteamBrowse,
} from "./workshop-library-core.ts";

it("round-trips share links without local paths or account data and deduplicates IDs", () => {
  const link = createWorkshopPackLink("5053820", [
    "3798216512",
    "3799026381",
    "3798216512",
  ]);
  assert.deepEqual(parseWorkshopPackLink(link), {
    version: 1,
    appId: "5053820",
    itemIds: ["3798216512", "3799026381"],
  });
  assert.deepEqual(
    [...new URL(link).searchParams.keys()],
    ["v", "appId", "items"]
  );
});
it("rejects hostile, ambiguous, oversized and unsupported shared packs", () => {
  const good = createWorkshopPackLink("5053820", ["3798216512"]);
  for (const input of [
    null,
    "https://evil.test/",
    good.replace("v=1", "v=2"),
    good + "&appId=42",
    good + "&file=C:/secret",
    good.replace("3798216512", "..%2F.."),
    good.replace("workshop?", "workshop/other?"),
    good.replace("5053820", "0"),
    good + "#secret",
    "x".repeat(5001),
  ])
    assert.throws(() => parseWorkshopPackLink(input));
  assert.throws(() =>
    createWorkshopPackLink(
      "5053820",
      Array.from({ length: 101 }, (_, i) => String(i + 1))
    )
  );
});
it("uses consumer identity, rejects collections and refuses non-Steam preview origins", () => {
  const raw = {
    publishedfileid: "1234",
    consumer_appid: 5053820,
    file_type: 0,
    title: "Pack",
    preview_url: "https://images.steamusercontent.com/ugc/123/",
    file_size: "2048",
  };
  assert.equal(parseCatalogueItem(raw, "5053820")?.size, 2048);
  assert.equal(
    parseCatalogueItem({ ...raw, consumer_appid: 42 }, "5053820"),
    null
  );
  assert.equal(parseCatalogueItem({ ...raw, file_type: 2 }, "5053820"), null);
  assert.equal(parseCatalogueItem({ ...raw, file_type: 9 }, "5053820"), null);
  assert.equal(
    parseCatalogueItem(
      { ...raw, preview_url: "https://images.steamusercontent.com.evil.test/" },
      "5053820"
    )?.previewUrl,
    null
  );
});
it("reads Steam SSR browse data without executing scripts and isolates another game's items", () => {
  const cache = {
    queries: [
      {
        state: {
          data: {
            eresult: 1,
            total_count: 35,
            total_pages: 2,
            results: [
              {
                publishedfileid: "1234",
                consumer_appid: 5053820,
                file_type: 0,
                title: "Pack",
              },
              {
                publishedfileid: "4567",
                consumer_appid: 42,
                file_type: 0,
                title: "Wrong game",
              },
            ],
          },
        },
      },
    ],
  };
  const html = `<script>throw new Error('must never execute')</script><script id="valve-ssr-data" type="application/json">${JSON.stringify({ renderContext: { queryData: JSON.stringify(cache) } })}</script>`;
  const result = parseSteamBrowse(html, "5053820", 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, "Pack");
  assert.equal(result.total, 35);
  assert.equal(result.hasMore, true);
  assert.equal(parseSteamBrowse(html, "9999", 1).total, 0);
  assert.throws(
    () => parseSteamBrowse("<html>layout changed</html>", "5053820", 1),
    /catalogue-format/
  );
});
