import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { creditsForCall, dailyBudget, rollCredits, wouldExceed } from "./credits.js";
import { packBatches, sinceUnixSeconds, MAX_HANDLES } from "./query.js";
import { advancedSearch, tweetsByIds } from "./twitter.js";
import { expandTweet } from "./expand.js";
import { collectTweetMedia, probeMediaUrls } from "./media.js";
import { verifyPermalink } from "./permalink.js";
import { toLiveRow } from "./triage.js";
import { dataFile, loadUniverse } from "./universe.js";
import { isLiveRow } from "../src/live.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_PAGES_PER_BATCH = 2;
const MAX_FEED = 250;
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

export function loadHandles() {
  const doc = JSON.parse(dataFile("handles.json"));
  const list = (doc.handles || []).map((h) => ({
    userName: String(h.userName || h).replace(/^@/, ""),
    tier: h.tier || "specialist",
  }));
  const out = [];
  const seen = new Set();
  for (const h of list) {
    const k = h.userName.toLowerCase();
    if (!h.userName || seen.has(k)) continue;
    seen.add(k);
    out.push(h);
  }
  if (out.length > MAX_HANDLES) throw new Error("refusing oversized handle list");
  return out;
}

function emptyState() {
  return { lastIngestUnix: 0, seenIds: [], credits: { date: "", used: 0 } };
}

function readJsonFile(p, fallback) {
  try {
    if (!existsSync(p)) return fallback;
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

function mergeRows(existing, incoming, now) {
  const map = new Map();
  for (const t of existing || []) {
    if (isLiveRow(t)) map.set(String(t.id), t);
  }
  for (const t of incoming || []) {
    if (isLiveRow(t)) map.set(String(t.id), t);
  }
  const cutoff = now.getTime() - MAX_AGE_MS;
  return [...map.values()]
    .filter((t) => new Date(t.time).getTime() >= cutoff)
    .sort((a, b) => new Date(b.time) - new Date(a.time))
    .slice(0, MAX_FEED);
}

export async function runIngest({
  now = new Date(),
  env = process.env,
  fetchImpl = fetch,
  search = advancedSearch,
  byIds = tweetsByIds,
  writeFiles = false,
  livePath = join(ROOT, "data", "live.json"),
  statePath = join(ROOT, "data", "ingest-state.json"),
} = {}) {
  const apiKey = env.TWITTERAPI_IO_KEY || "";
  if (!apiKey) {
    return { ok: true, skipped: "no_key" };
  }

  const handles = loadHandles();
  const universe = loadUniverse(dataFile("universe.csv"));
  const tiers = new Map(handles.map((h) => [h.userName.toLowerCase(), h.tier]));
  const budget = dailyBudget(env);

  let state = rollCredits(readJsonFile(statePath, emptyState()), now);
  const existing = readJsonFile(livePath, []);
  const existingRows = Array.isArray(existing) ? existing : [];

  if (state.credits.used >= budget) {
    return { ok: true, skipped: "daily_cap", creditsUsed: state.credits.used, budget };
  }

  const nowSec = Math.floor(now.getTime() / 1000);
  const since = sinceUnixSeconds(nowSec, state.lastIngestUnix);
  const batches = packBatches(
    handles.map((h) => h.userName),
    since,
  );

  const idCache = new Map();
  const getById = async (id) => {
    const k = String(id);
    if (idCache.has(k)) return idCache.get(k);
    if (wouldExceed(state.credits.used, creditsForCall(0), budget)) {
      idCache.set(k, null);
      return null;
    }
    const tweets = await byIds({ apiKey, ids: [k], fetchImpl });
    state.credits.used += creditsForCall(tweets.length);
    const hit = tweets.find((t) => String(t.id) === k) || null;
    idCache.set(k, hit);
    return hit;
  };

  const kept = [];
  let fetched = 0;
  let dropped = 0;
  let calls = 0;
  let stopped = null;
  let anySuccess = false;
  const seen = new Set(state.seenIds || []);

  for (const batch of batches) {
    let cursor = "";
    for (let page = 0; page < MAX_PAGES_PER_BATCH; page++) {
      if (wouldExceed(state.credits.used, creditsForCall(0), budget)) {
        stopped = "daily_cap";
        break;
      }
      let result;
      try {
        result = await search({ apiKey, query: batch.query, cursor, fetchImpl });
      } catch {
        stopped = "api_error";
        break;
      }
      anySuccess = true;
      const tweets = result.tweets || [];
      state.credits.used += creditsForCall(tweets.length);
      calls += 1;
      fetched += tweets.length;

      for (const tweet of tweets) {
        const id = String(tweet.id || "");
        if (!id) {
          dropped += 1;
          continue;
        }
        if (seen.has(id)) {
          dropped += 1;
          continue;
        }
        seen.add(id);

        const handle = String(tweet.author?.userName || "").replace(/^@/, "");
        if (!handle || !tiers.has(handle.toLowerCase())) {
          dropped += 1;
          continue;
        }

        const expanded = await expandTweet(tweet, {
          fetchImpl,
          getById,
          collectMedia: collectTweetMedia,
        });
        if (!expanded.ok) {
          dropped += 1;
          continue;
        }

        let media = collectTweetMedia(tweet);
        media = await probeMediaUrls(media, { fetchImpl });

        const judged = toLiveRow(tweet, {
          corpus: expanded.corpus,
          media,
          universe,
          handleTier: tiers.get(handle.toLowerCase()),
        });
        if (!judged.keep || !judged.item) {
          dropped += 1;
          continue;
        }

        const verified = await verifyPermalink(handle, id, { fetchImpl, getById });
        if (!verified.ok) {
          dropped += 1;
          continue;
        }
        judged.item.permalink = verified.permalink;
        judged.item.media = media;
        judged.item.has_media = media.length > 0;
        if (!isLiveRow(judged.item)) {
          dropped += 1;
          continue;
        }
        kept.push(judged.item);
      }

      if (!result.has_next_page || !result.next_cursor || tweets.length === 0) break;
      cursor = result.next_cursor;
    }
    if (stopped) break;
  }

  if (anySuccess) state.lastIngestUnix = nowSec;
  state.seenIds = [...seen].slice(-8000);
  state.updatedAt = now.toISOString();

  const merged = mergeRows(existingRows, kept, now);
  let wrote = false;
  if (writeFiles && anySuccess && merged.length) {
    mkdirSync(dirname(livePath), { recursive: true });
    writeFileSync(livePath, `${JSON.stringify(merged, null, 2)}\n`);
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
    wrote = true;
  } else if (writeFiles && anySuccess) {
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  }

  return {
    ok: true,
    skipped: stopped,
    batches: batches.length,
    calls,
    fetched,
    kept: kept.length,
    dropped,
    creditsUsed: state.credits.used,
    budget,
    wrote,
    since,
  };
}
