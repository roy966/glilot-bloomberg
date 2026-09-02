import test from "node:test";
import assert from "node:assert/strict";
import { judgeKeep } from "../lib/triage.js";
import { dataFile, findTickers, loadUniverse } from "../lib/universe.js";
import { expandTweet } from "../lib/expand.js";
import { verifyPermalink } from "../lib/permalink.js";
import { collectTweetMedia } from "../lib/media.js";
import { packBatches, ACCOUNT_LIST_MAX, FULL_QUERY_MAX } from "../lib/query.js";
import { runIngest } from "../lib/ingest.js";
import { searchUrl } from "../lib/twitter.js";

const universe = loadUniverse(dataFile("universe.csv"));

const keepCorpus =
  "Primary checks: GB300 NVL72 racks quoting 132 kW at the wall, 20% above last year's 110 kW. NVIDIA GB300 CoWoS packaging is the constraint, not the GPU die.";

test("KEEP high-signal numbered NVIDIA/semis note", () => {
  const r = judgeKeep(keepCorpus, { universe, handleTier: "specialist", mediaCount: 0 });
  assert.equal(r.keep, true);
  assert.ok(r.tickers.includes("NVDA"));
});

test("DROP memes and engagement bait from the same handles", () => {
  assert.equal(judgeKeep("gm fam lmao", { universe, handleTier: "specialist" }).keep, false);
  assert.equal(judgeKeep("thoughts?", { universe, handleTier: "specialist" }).keep, false);
  assert.equal(
    judgeKeep("NVDA to the moon calls printing", { universe, handleTier: "specialist" }).keep,
    false,
  );
});

test("DROP unsourced rumor and off-topic", () => {
  assert.equal(
    judgeKeep("I heard someone told me NVDA is cooked", { universe, handleTier: "specialist" }).keep,
    false,
  );
  assert.equal(
    judgeKeep("Great sunset in Santorini today, 80F and 10mph wind", { universe }).keep,
    false,
  );
});

test("gazetteer false positives are not universe hits", () => {
  assert.deepEqual(findTickers("send me the bill for dinner", universe), []);
  assert.deepEqual(findTickers("the IT department issued laptops", universe), []);
});

test("wire needs universe + two numbers", () => {
  const weak = judgeKeep("AI is changing everything in Silicon Valley this week", {
    universe,
    handleTier: "wire",
  });
  assert.equal(weak.keep, false);
  const strong = judgeKeep(
    "Cloudflare said Q2 revenue was $0.43bn, up 30%, as NET US security attach rose.",
    { universe, handleTier: "wire" },
  );
  assert.equal(strong.keep, true);
  assert.ok(strong.tickers.includes("NET"));
});

test("unexpanded quote or parent is DROP", async () => {
  const quote = await expandTweet(
    {
      id: "1",
      text: "see this",
      entities: { urls: [{ expanded_url: "https://x.com/a/status/99" }] },
    },
    { getById: async () => null, collectMedia: () => [] },
  );
  assert.equal(quote.ok, false);
  const parent = await expandTweet(
    { id: "2", text: "reply", isReply: true, inReplyToId: "88" },
    { getById: async () => null, collectMedia: () => [] },
  );
  assert.equal(parent.ok, false);
});

test("pic.twitter.com without media URLs is unexpanded", async () => {
  const r = await expandTweet(
    { id: "3", text: "chart pic.twitter.com/abc", entities: {} },
    { collectMedia: () => [] },
  );
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unexpanded-media");
});

test("permalink 404 or wrong tweet is DROP", async () => {
  const fetch404 = async () => ({ status: 404, ok: false, json: async () => null });
  const r = await verifyPermalink("SemiAnalysis_", "1", { fetchImpl: fetch404 });
  assert.equal(r.ok, false);

  const fetchWrong = async (url) => {
    if (String(url).includes("oembed")) {
      return {
        status: 200,
        ok: true,
        json: async () => ({ html: "other", url: "https://x.com/foo/status/2", author_url: "https://x.com/foo" }),
      };
    }
    return { status: 404, ok: false, json: async () => null };
  };
  const w = await verifyPermalink("SemiAnalysis_", "1", { fetchImpl: fetchWrong });
  assert.equal(w.ok, false);
});

test("collectTweetMedia keeps quoted CDN urls and never seed SVGs", () => {
  const urls = collectTweetMedia({
    entities: { media: [{ media_url_https: "https://pbs.twimg.com/media/a.jpg" }] },
    quoted_tweet: {
      entities: { media: [{ media_url_https: "https://pbs.twimg.com/media/q.jpg" }] },
    },
  });
  assert.deepEqual(urls, ["https://pbs.twimg.com/media/a.jpg", "https://pbs.twimg.com/media/q.jpg"]);
  const seed = collectTweetMedia({
    media: ["static/charts/gpu-rack-kw.svg"],
  });
  assert.deepEqual(seed, []);
});

test("query batches stay under length caps and put since_time in query", () => {
  const handles = JSON.parse(dataFile("handles.json")).handles.map((h) => h.userName);
  const batches = packBatches(handles, 1715817600);
  assert.ok(batches.length >= 1);
  for (const b of batches) {
    assert.ok(b.accountPart.length <= ACCOUNT_LIST_MAX);
    assert.ok(b.query.length <= FULL_QUERY_MAX);
    assert.match(b.query, /since_time:1715817600/);
    const url = searchUrl(b.query);
    assert.ok(url.includes("query="));
    assert.ok(!url.includes("since_time=") || url.includes("since_time%3A"));
    const u = new URL(url);
    assert.equal(u.searchParams.has("since_time"), false);
    assert.match(u.searchParams.get("query"), /since_time:1715817600/);
  }
});

test("ingest no-ops when key unset (seed fallback)", async () => {
  const r = await runIngest({ env: {}, writeFiles: false, skipSubstack: true });
  assert.equal(r.skipped, "no_key");
  assert.equal(r.ok, true);
});

test("ingest DROPs when permalink cannot be verified", async () => {
  const tweet = {
    id: "1962100180123456789",
    text: keepCorpus,
    createdAt: "2026-09-02T09:40:00.000Z",
    author: { userName: "SemiAnalysis_", name: "SemiAnalysis" },
    entities: {},
  };
  const fetchImpl = async () => ({ status: 404, ok: false, json: async () => null });
  const r = await runIngest({
    env: { TWITTERAPI_IO_KEY: "test" },
    writeFiles: false,
    skipSubstack: true,
    fetchImpl,
    search: async () => ({ tweets: [tweet], has_next_page: false, next_cursor: "" }),
    byIds: async () => [],
  });
  assert.equal(r.kept, 0);
  assert.ok(r.dropped >= 1);
});

test("ingest KEEP verified high-signal numbered tweet with empty media", async () => {
  const tweet = {
    id: "1962100180123456789",
    text: keepCorpus,
    createdAt: "2026-09-02T09:40:00.000Z",
    author: { userName: "SemiAnalysis_", name: "SemiAnalysis" },
    entities: {},
  };
  const permalink = "https://x.com/SemiAnalysis_/status/1962100180123456789";
  const fetchImpl = async (url) => {
    if (String(url).includes("oembed")) {
      return {
        status: 200,
        ok: true,
        json: async () => ({
          html: `SemiAnalysis_ ${permalink}`,
          url: permalink,
          author_url: "https://x.com/SemiAnalysis_",
        }),
      };
    }
    return { status: 200, ok: true, json: async () => ({}), text: async () => "" };
  };
  const r = await runIngest({
    env: { TWITTERAPI_IO_KEY: "test" },
    writeFiles: false,
    skipSubstack: true,
    fetchImpl,
    search: async () => ({ tweets: [tweet], has_next_page: false, next_cursor: "" }),
    byIds: async () => [tweet],
  });
  assert.equal(r.kept, 1);
});

test("refuses a huge handle list", () => {
  const huge = Array.from({ length: 200 }, (_, i) => `user${i}`);
  assert.throws(() => packBatches(huge, 1715817600), /oversized/);
});
