import test from "node:test";
import assert from "node:assert/strict";
import { isLiveRow, isWellFormedLiveFeed, permalinkMatches } from "../src/live.js";

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

test("seed-style local SVG media is rejected for live rows", () => {
  assert.equal(
    isLiveRow({ ...okRow, media: ["static/charts/gpu-rack-kw.svg"] }),
    false,
  );
  assert.equal(
    isLiveRow({
      ...okRow,
      media: ["https://pbs.twimg.com/media/example.jpg"],
    }),
    true,
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
});
