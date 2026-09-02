import test from "node:test";
import assert from "node:assert/strict";
import { isLiveRow, isWellFormedLiveFeed, permalinkMatches, mixesSeedCharts } from "../src/live.js";

const okRow = {
  id: "1962100180123456789",
  time: "2026-09-02T09:40:00.000Z",
  summary:
    "GB300 NVL72 drawing 132 kW at the rack; facility CDU, not the GPU, is the 2026 bottleneck.",
  full_text:
    "Primary checks: GB300 NVL72 configurations are quoting 120–132 kW at the rack wall. GPU silicon is not the constraint.",
  handle: "SemiAnalysis_",
  source: "SemiAnalysis",
  category: ":NVDA US",
  permalink: "https://x.com/SemiAnalysis_/status/1962100180123456789",
  media: [],
  top: true,
  tickers: ["NVDA"],
  themes: ["AI", "CHIPS"],
  sectors: ["Semis & HW"],
  in_universe: true,
};

test("well-formed live array is accepted", () => {
  assert.equal(isWellFormedLiveFeed([okRow]), true);
});

test("permalink user and id must match", () => {
  assert.equal(permalinkMatches(okRow), true);
  assert.equal(
    permalinkMatches({
      ...okRow,
      permalink: "https://x.com/SemiAnalysis_/status/000",
    }),
    false,
  );
  assert.equal(
    permalinkMatches({
      ...okRow,
      permalink: "https://x.com/DigitimesNews/status/1962100180123456789",
    }),
    false,
  );
});

test("seed charts mixed with live ids are rejected", () => {
  const mixed = { ...okRow, media: ["static/charts/gpu-rack-kw.svg"] };
  assert.equal(mixesSeedCharts(mixed), true);
  assert.equal(isLiveRow(mixed), false);
  assert.equal(isWellFormedLiveFeed([mixed]), false);
  assert.equal(
    isLiveRow({
      ...okRow,
      media: ["https://pbs.twimg.com/media/example.jpg"],
    }),
    true,
  );
});

test("non-tweet CDN https is not live media for X rows", () => {
  assert.equal(
    isLiveRow({ ...okRow, media: ["https://example.com/chart.png"] }),
    false,
  );
});

test("empty or malformed live.json falls through", () => {
  assert.equal(isWellFormedLiveFeed([]), false);
  assert.equal(isWellFormedLiveFeed({ tweets: [okRow] }), false);
  assert.equal(isWellFormedLiveFeed(null), false);
  const missingTime = { ...okRow };
  delete missingTime.time;
  assert.equal(isWellFormedLiveFeed([missingTime]), false);
  assert.equal(isLiveRow({ ...okRow, top: "true" }), false);
  assert.equal(isLiveRow({ ...okRow, id: "t001" }), false);
});

const ssRow = {
  id: "semianalysis.com:xais-colossus-2-first-gigawatt-datacenter",
  time: "2026-09-02T09:40:00.000Z",
  summary: "xAI Colossus 2 is the first gigawatt AI datacenter; Colossus 1 still ~300 MW.",
  full_text:
    "Colossus 1’s ~300 MW looks modest next to gigawatt-scale clusters. NVIDIA GB200 NVL72 counts and 200,000 H100s are the print.",
  handle: "semianalysis",
  source: "SemiAnalysis",
  category: ":NVDA US",
  permalink: "https://semianalysis.com/2025/09/16/xais-colossus-2-first-gigawatt-datacenter/",
  media: ["https://substackcdn.com/image/fetch/photo.png"],
  top: true,
  kind: "substack",
};

test("substack rows accept slug ids and non-x.com permalinks", () => {
  assert.equal(isLiveRow(ssRow), true);
  assert.equal(
    isLiveRow({ ...ssRow, permalink: "https://x.com/SemiAnalysis_/status/1" }),
    false,
  );
  assert.equal(
    isLiveRow({ ...ssRow, media: ["static/charts/gpu-rack-kw.svg"] }),
    false,
  );
});

test("mixed X + Substack live.json is well-formed", () => {
  assert.equal(isWellFormedLiveFeed([okRow, ssRow]), true);
});
