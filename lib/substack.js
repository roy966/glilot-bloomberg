import { dataFile } from "./universe.js";
import { parseRssItems, makeSubstackId, stripHtml } from "./rss.js";
import { judgeSubstackKeep, toSubstackRow } from "./triage.js";
import { probeMediaUrls } from "./media.js";
import { isSubstackMedia, isLiveRow } from "../src/live.js";

export const MAX_SUBSTACK_PUBS = 400;
export const FEED_CONCURRENCY = 8;
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

const SKIP_IMG =
  /avatar|profile|emoji|1x1|pixel|track|subscribe|gravatar|favicon|apple-touch|wordpress\.com\/i/i;

export function publicationsFromDoc(doc) {
  const list = doc?.publications || [];
  if (list.length > MAX_SUBSTACK_PUBS) throw new Error("refusing oversized substack list");
  const seen = new Set();
  const out = [];
  for (const p of list) {
    const name = String(p.name || p.source || "").trim();
    const rss = String(p.feed || p.rss || "").trim();
    if (!name || !/^https:\/\//i.test(rss)) continue;
    const key = rss.toLowerCase().replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name,
      rss,
      feed: rss,
      source: p.source || name,
      handle: String(p.handle || name)
        .toLowerCase()
        .replace(/\s+/g, ""),
    });
  }
  return out;
}

export function loadPublications() {
  return publicationsFromDoc(JSON.parse(dataFile("substacks.json")));
}

async function mapPool(items, n, fn) {
  const ret = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      ret[idx] = await fn(items[idx], idx);
    }
  }
  const workers = Math.min(Math.max(1, n), items.length || 1);
  await Promise.all(Array.from({ length: items.length ? workers : 0 }, worker));
  return ret;
}

export function imagesFromHtml(html, base) {
  const urls = [];
  const push = (raw) => {
    if (!raw) return;
    let abs = raw;
    try {
      abs = new URL(raw, base).href;
    } catch {
      return;
    }
    if (SKIP_IMG.test(abs)) return;
    if (!isSubstackMedia(abs)) return;
    if (!urls.includes(abs)) urls.push(abs);
  };
  const src = String(html || "");
  for (const m of src.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) push(m[1]);
  for (const m of src.matchAll(/property=["']og:image["'][^>]*content=["']([^"']+)["']/gi)) push(m[1]);
  for (const m of src.matchAll(/content=["']([^"']+)["'][^>]*property=["']og:image["']/gi)) push(m[1]);
  return urls;
}

export async function verifySubstackPermalink(permalink, id, { fetchImpl = fetch } = {}) {
  if (!/^https:\/\//i.test(permalink)) return { ok: false, reason: "not-https" };
  let res;
  try {
    res = await fetchImpl(permalink, {
      redirect: "follow",
      headers: { "user-agent": "glilot-bloomberg-ingest/1.0" },
    });
  } catch {
    return { ok: false, reason: "unverified" };
  }
  if (res.status === 404) return { ok: false, reason: "404" };
  if (!res.ok) return { ok: false, reason: "unverified" };
  const html = await res.text();
  const finalUrl = res.url || permalink;
  const slug = String(id).includes(":") ? String(id).slice(String(id).lastIndexOf(":") + 1) : String(id);
  const canonM =
    html.match(/rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) ||
    html.match(/href=["']([^"']+)["'][^>]*rel=["']canonical["']/i);
  const canonical = canonM ? canonM[1] : finalUrl;
  const hay = `${canonical} ${finalUrl}`.toLowerCase();
  if (!slug || !hay.includes(String(slug).toLowerCase())) {
    return { ok: false, reason: "not-that-post" };
  }
  try {
    const u = new URL(canonical, permalink);
    if (u.protocol !== "https:") return { ok: false, reason: "not-https" };
    return { ok: true, permalink: u.href, html };
  } catch {
    return { ok: false, reason: "unverified" };
  }
}

export async function ingestSubstack({
  now = new Date(),
  fetchImpl = fetch,
  universe,
  seen,
} = {}) {
  const pubs = loadPublications();
  const kept = [];
  let fetched = 0;
  let dropped = 0;
  let okFeeds = 0;
  const cutoff = now.getTime() - MAX_AGE_MS;
  const seenSet = seen instanceof Set ? seen : new Set(seen || []);
  const seenCanonical = new Set();

  const feeds = await mapPool(pubs, FEED_CONCURRENCY, async (pub) => {
    try {
      const res = await fetchImpl(pub.rss, {
        headers: {
          "user-agent": "glilot-bloomberg-ingest/1.0",
          accept: "application/rss+xml, application/xml, text/xml",
        },
      });
      if (!res.ok) return { pub, xml: null };
      return { pub, xml: await res.text() };
    } catch {
      return { pub, xml: null };
    }
  });

  for (const { pub, xml } of feeds) {
    if (!xml || !/<item|<entry/i.test(xml)) {
      dropped += 1;
      continue;
    }
    okFeeds += 1;
    const items = parseRssItems(xml);
    fetched += items.length;

    for (const item of items) {
      const permalink = item.link;
      if (!/^https:\/\//i.test(permalink)) {
        dropped += 1;
        continue;
      }
      const id = makeSubstackId(permalink, item.guid);
      if (!id || seenSet.has(id)) {
        dropped += 1;
        continue;
      }
      seenSet.add(id);
      const published = item.pubDate ? new Date(item.pubDate).getTime() : now.getTime();
      if (!Number.isFinite(published) || published < cutoff) {
        dropped += 1;
        continue;
      }

      const htmlBits = `${item.content || ""}\n${item.description || ""}`;
      const corpus = [item.title, stripHtml(htmlBits)].filter(Boolean).join("\n");

      // KEEP from RSS text first so 278 feeds do not dump / fetch every post.
      if (!judgeSubstackKeep(corpus, { universe }).keep) {
        dropped += 1;
        continue;
      }

      const verified = await verifySubstackPermalink(permalink, id, { fetchImpl });
      if (!verified.ok) {
        dropped += 1;
        continue;
      }
      const canon = String(verified.permalink || "").replace(/\/$/, "").toLowerCase();
      if (canon && seenCanonical.has(canon)) {
        dropped += 1;
        continue;
      }
      if (canon) seenCanonical.add(canon);

      let media = [];
      if (item.enclosure && /image\//i.test(item.enclosureType || "image/jpeg")) {
        media.push(item.enclosure);
      }
      media.push(...imagesFromHtml(htmlBits, permalink));
      media.push(...imagesFromHtml(verified.html || "", verified.permalink));
      media = [...new Set(media.filter((u) => isSubstackMedia(u) && !SKIP_IMG.test(u)))];
      media = await probeMediaUrls(media, { fetchImpl, allow: isSubstackMedia });

      const judged = toSubstackRow(
        {
          id,
          permalink: verified.permalink,
          pubDate: item.pubDate,
          title: item.title,
        },
        { corpus, media, universe, pub },
      );
      if (!judged.keep || !judged.item) {
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
  }

  return { ok: okFeeds > 0, kept, fetched, dropped, feeds: okFeeds, pubs: pubs.length };
}
