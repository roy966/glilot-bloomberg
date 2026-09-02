const STATUS_RE = /(?:x\.com|twitter\.com)\/([^/]+)\/status\/(\d+)/i;
const TCO = /https?:\/\/t\.co\/\S+/i;

export function statusIdFromUrl(url) {
  const m = String(url || "").match(STATUS_RE);
  return m ? { handle: m[1], id: m[2] } : null;
}

export function needsParent(tweet) {
  return Boolean(tweet?.isReply || tweet?.inReplyToId);
}

export function quoteIdFromTweet(tweet) {
  if (tweet?.quoted_tweet?.id) return String(tweet.quoted_tweet.id);
  if (tweet?.quotedTweet?.id) return String(tweet.quotedTweet.id);
  const urls = tweet?.entities?.urls || [];
  for (const u of urls) {
    const hit = statusIdFromUrl(u.expanded_url || u.url);
    if (hit) return hit.id;
  }
  const text = String(tweet?.text || "");
  const hit = statusIdFromUrl(text);
  return hit?.id || null;
}

export function outboundLinks(tweet) {
  const urls = tweet?.entities?.urls || [];
  const out = [];
  for (const u of urls) {
    const expanded = u.expanded_url || u.unwound_url || "";
    if (statusIdFromUrl(expanded || u.url)) continue;
    out.push({ url: u.url || "", expanded });
  }
  return out;
}

async function resolveHttp(url, fetchImpl, timeoutMs = 8000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      signal: ac.signal,
      headers: { "user-agent": "glilot-bloomberg-ingest/1.0" },
    });
    const finalUrl = res.url || url;
    let title = "";
    if (res.ok) {
      const text = await res.text();
      const m = text.match(/<title[^>]*>([^<]+)<\/title>/i);
      title = m ? m[1].trim().slice(0, 200) : "";
    }
    return { ok: res.ok || res.status < 500, finalUrl, title, status: res.status };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Expand quoted/parent tweets, images, and links before KEEP/DROP.
 * If something needs expansion and cannot be expanded, return ok:false (DROP).
 */
export async function expandTweet(tweet, { fetchImpl = fetch, getById, collectMedia } = {}) {
  const reasons = [];
  const quoted = tweet.quoted_tweet || tweet.quotedTweet || null;
  const quoteId = quoteIdFromTweet(tweet);
  let quotedTweet = quoted;
  if (quoteId && !quotedTweet) {
    if (typeof getById !== "function") return { ok: false, reason: "unexpanded-quote" };
    quotedTweet = await getById(quoteId);
    if (!quotedTweet) return { ok: false, reason: "unexpanded-quote" };
  }

  let parent = null;
  if (needsParent(tweet)) {
    const pid = tweet.inReplyToId;
    if (!pid) return { ok: false, reason: "unexpanded-parent" };
    if (typeof getById !== "function") return { ok: false, reason: "unexpanded-parent" };
    parent = await getById(pid);
    if (!parent) return { ok: false, reason: "unexpanded-parent" };
  }

  const links = [];
  for (const link of outboundLinks(tweet)) {
    let expanded = link.expanded;
    if (!expanded || TCO.test(expanded)) {
      const resolved = await resolveHttp(link.url || expanded, fetchImpl);
      if (!resolved || !resolved.finalUrl || TCO.test(resolved.finalUrl)) {
        return { ok: false, reason: "unexpanded-link" };
      }
      expanded = resolved.finalUrl;
      links.push({ url: expanded, title: resolved.title || "" });
    } else {
      const page = await resolveHttp(expanded, fetchImpl);
      links.push({ url: expanded, title: page?.title || "" });
    }
  }

  const mediaFn = collectMedia || (() => []);
  const media = mediaFn(tweet);
  const hinted =
    /pic\.twitter\.com|pic\.x\.com|pbs\.twimg\.com|\/photo\/1|\/video\/1/i.test(
      String(tweet.text || ""),
    ) ||
    (tweet.entities?.media || []).length > 0 ||
    (tweet.extendedEntities?.media || []).length > 0;
  if (hinted && (!media || media.length === 0)) {
    return { ok: false, reason: "unexpanded-media" };
  }

  const parts = [
    tweet.text || tweet.full_text || "",
    quotedTweet?.text || "",
    parent?.text || "",
    ...links.map((l) => `${l.title} ${l.url}`),
  ];
  return {
    ok: true,
    reasons,
    quoted: quotedTweet,
    parent,
    links,
    media: media || [],
    corpus: parts.join("\n"),
  };
}
