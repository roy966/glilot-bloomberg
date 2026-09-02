import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { judgeKeep } from "../lib/triage.js";
import { dataFile, findTickers, loadUniverse } from "../lib/universe.js";
import { expandTweet, isSelfReply } from "../lib/expand.js";
import { verifyPermalink } from "../lib/permalink.js";
import { collectTweetMedia } from "../lib/media.js";
import {
  packBatches,
  lookbackPlan,
  ACCOUNT_LIST_MAX,
  FULL_QUERY_MAX,
  CATCHUP_LOOKBACK_SEC,
  MIN_LOOKBACK_SEC,
  MAX_LOOKBACK_SEC,
} from "../lib/query.js";
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

test("query includes self-replies and puts since_time in query", () => {
  const handles = JSON.parse(dataFile("handles.json")).handles.map((h) => h.userName);
  const batches = packBatches(handles, 1715817600);
  assert.ok(batches.length >= 1);
  for (const b of batches) {
    assert.ok(b.accountPart.length <= ACCOUNT_LIST_MAX);
    assert.ok(b.query.length <= FULL_QUERY_MAX);
    assert.match(b.query, /since_time:1715817600/);
    assert.doesNotMatch(b.query, /filter:replies/);
    const url = searchUrl(b.query);
    assert.ok(url.includes("query="));
    assert.ok(!url.includes("since_time=") || url.includes("since_time%3A"));
    const u = new URL(url);
    assert.equal(u.searchParams.has("since_time"), false);
    assert.match(u.searchParams.get("query"), /since_time:1715817600/);
    assert.doesNotMatch(u.searchParams.get("query"), /filter:replies/);
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

test("12h first/catch-up lookback then 25–40 min steady", () => {
  const now = 1_800_000_000;
  const first = lookbackPlan(now, 0);
  assert.equal(first.catchup, true);
  assert.equal(first.lookback, CATCHUP_LOOKBACK_SEC);
  assert.equal(now - first.since, CATCHUP_LOOKBACK_SEC);

  const noLive = lookbackPlan(now, now - 10 * 60, { hasLiveFeed: false });
  assert.equal(noLive.catchup, true);
  assert.equal(noLive.lookback, CATCHUP_LOOKBACK_SEC);

  const steady = lookbackPlan(now, now - 10 * 60, { hasLiveFeed: true });
  assert.equal(steady.catchup, false);
  assert.ok(steady.lookback >= MIN_LOOKBACK_SEC);
  assert.ok(steady.lookback <= MAX_LOOKBACK_SEC);

  const stale = lookbackPlan(now, now - 3 * 3600, { hasLiveFeed: true });
  assert.equal(stale.catchup, true);
  assert.ok(stale.lookback > MAX_LOOKBACK_SEC);
  assert.ok(stale.lookback <= CATCHUP_LOOKBACK_SEC);
});

test("self-thread expands parent; other-user reply DROPs without parent", async () => {
  const parent = {
    id: "10",
    text: keepCorpus,
    author: { userName: "SemiAnalysis_" },
  };
  const self = {
    id: "11",
    text: "CoWoS remains 20% short. (2/2)",
    isReply: true,
    inReplyToId: "10",
    inReplyToUsername: "SemiAnalysis_",
    author: { userName: "SemiAnalysis_" },
  };
  assert.equal(isSelfReply(self), true);
  const ok = await expandTweet(self, {
    getById: async (id) => (String(id) === "10" ? parent : null),
    collectMedia: () => [],
  });
  assert.equal(ok.ok, true);
  assert.match(ok.corpus, /132 kW/);

  const other = {
    id: "12",
    text: "replying to a customer",
    isReply: true,
    inReplyToId: "99",
    inReplyToUsername: "someone_else",
    author: { userName: "SemiAnalysis_" },
  };
  assert.equal(isSelfReply(other), false);
  const bad = await expandTweet(other, { getById: async () => null, collectMedia: () => [] });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, "unexpanded-parent");
});

function oembedFetch(handle, id) {
  const permalink = `https://x.com/${handle}/status/${id}`;
  return async (url) => {
    if (String(url).includes("oembed")) {
      return {
        status: 200,
        ok: true,
        json: async () => ({
          html: `${handle} ${permalink}`,
          url: permalink,
          author_url: `https://x.com/${handle}`,
        }),
      };
    }
    return { status: 200, ok: true, json: async () => ({}), text: async () => "" };
  };
}

test("billing cache does not skip a KEEP tweet never written to live.json", async () => {
  const tweet = {
    id: "1962100180123456799",
    text: keepCorpus,
    createdAt: "2026-09-02T09:40:00.000Z",
    author: { userName: "SemiAnalysis_", name: "SemiAnalysis" },
    entities: {},
  };
  const dir = mkdtempSync(join(tmpdir(), "glilot-ingest-"));
  const livePath = join(dir, "live.json");
  const statePath = join(dir, "ingest-state.json");
  writeFileSync(
    statePath,
    JSON.stringify({
      lastIngestUnix: 0,
      seenIds: [tweet.id],
      credits: { date: "2026-09-02", used: 0 },
    }),
  );
  const r = await runIngest({
    env: { TWITTERAPI_IO_KEY: "test" },
    writeFiles: true,
    skipSubstack: true,
    livePath,
    statePath,
    fetchImpl: oembedFetch("SemiAnalysis_", tweet.id),
    search: async () => ({ tweets: [tweet], has_next_page: false, next_cursor: "" }),
    byIds: async () => [tweet],
  });
  assert.equal(r.kept, 1);
  assert.equal(r.wrote, true);
  const live = JSON.parse(readFileSync(livePath, "utf8"));
  assert.equal(live[0].id, tweet.id);
});

test("ids already in live.json are not duplicated", async () => {
  const tweet = {
    id: "1962100180123456798",
    text: keepCorpus,
    createdAt: "2026-09-02T09:40:00.000Z",
    author: { userName: "SemiAnalysis_", name: "SemiAnalysis" },
    entities: {},
  };
  const dir = mkdtempSync(join(tmpdir(), "glilot-ingest-"));
  const livePath = join(dir, "live.json");
  const statePath = join(dir, "ingest-state.json");
  const existing = {
    id: tweet.id,
    time: tweet.createdAt,
    summary: "already there",
    full_text: keepCorpus,
    handle: "SemiAnalysis_",
    source: "SemiAnalysis",
    category: ":NVDA US",
    permalink: `https://x.com/SemiAnalysis_/status/${tweet.id}`,
    media: [],
    top: true,
    kind: "x",
  };
  writeFileSync(livePath, `${JSON.stringify([existing], null, 2)}\n`);
  writeFileSync(statePath, JSON.stringify({ lastIngestUnix: 1_700_000_000, seenIds: [], credits: { date: "", used: 0 } }));
  const r = await runIngest({
    env: { TWITTERAPI_IO_KEY: "test" },
    writeFiles: false,
    skipSubstack: true,
    livePath,
    statePath,
    fetchImpl: oembedFetch("SemiAnalysis_", tweet.id),
    search: async () => ({ tweets: [tweet], has_next_page: false, next_cursor: "" }),
    byIds: async () => [tweet],
  });
  assert.equal(r.kept, 0);
  assert.ok(r.dropped >= 1);
});

test("self-thread KEEP after parent expand", async () => {
  const parent = {
    id: "1962100180123456701",
    text: keepCorpus,
    createdAt: "2026-09-02T09:39:00.000Z",
    author: { userName: "SemiAnalysis_", name: "SemiAnalysis" },
    entities: {},
  };
  const reply = {
    id: "1962100180123456702",
    text: "HBM and CoWoS remain 20% short of 2026 demand. (2/2)",
    createdAt: "2026-09-02T09:40:00.000Z",
    isReply: true,
    inReplyToId: parent.id,
    inReplyToUsername: "SemiAnalysis_",
    author: { userName: "SemiAnalysis_", name: "SemiAnalysis" },
    entities: {},
  };
  const dir = mkdtempSync(join(tmpdir(), "glilot-ingest-"));
  const r = await runIngest({
    env: { TWITTERAPI_IO_KEY: "test" },
    writeFiles: false,
    skipSubstack: true,
    livePath: join(dir, "live.json"),
    statePath: join(dir, "ingest-state.json"),
    fetchImpl: oembedFetch("SemiAnalysis_", reply.id),
    search: async () => ({ tweets: [reply], has_next_page: false, next_cursor: "" }),
    byIds: async (args) => {
      const ids = args?.ids || [];
      return [parent, reply].filter((t) => ids.map(String).includes(String(t.id)));
    },
  });
  assert.equal(r.kept, 1);
});
