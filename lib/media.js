import { isTweetCdnMedia } from "../src/live.js";

const MEDIA_HINT =
  /pic\.twitter\.com|pic\.x\.com|pbs\.twimg\.com|video\.twimg\.com|\/photo\/1|\/video\/1/i;

export function tweetHasMediaHint(tweet) {
  const text = String(tweet?.text || tweet?.full_text || "");
  const entities = tweet?.entities || {};
  const ext = tweet?.extendedEntities || tweet?.extended_entities || {};
  if ((entities.media || []).length || (ext.media || []).length || (tweet?.media || []).length) {
    return true;
  }
  if (MEDIA_HINT.test(text)) return true;
  for (const u of entities.urls || []) {
    const blob = `${u.url || ""} ${u.expanded_url || ""} ${u.display_url || ""}`;
    if (MEDIA_HINT.test(blob)) return true;
  }
  return false;
}

function pushMediaUrl(out, u) {
  if (!isTweetCdnMedia(u)) return;
  if (!out.includes(u)) out.push(u);
}

function walkMedia(obj, out) {
  if (!obj || typeof obj !== "object") return;
  const entities = obj.entities || {};
  const ext = obj.extendedEntities || obj.extended_entities || {};
  const media = [...(entities.media || []), ...(ext.media || []), ...(obj.media || [])];
  for (const m of media) {
    pushMediaUrl(out, m.media_url_https || m.media_url || m.preview_image_url);
    const variants = m.video_info?.variants || m.videoInfo?.variants || [];
    const mp4 = variants.filter((v) => /mp4/i.test(v.content_type || v.contentType || ""));
    if (mp4.length) {
      mp4.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      pushMediaUrl(out, mp4[0].url);
    }
  }
}

/** This tweet's attachments plus quoted-tweet media. Never seed SVGs. Never other tweets. */
export function collectTweetMedia(tweet) {
  const out = [];
  walkMedia(tweet, out);
  walkMedia(tweet.quoted_tweet || tweet.quotedTweet, out);
  walkMedia(tweet.retweeted_tweet || tweet.retweetedTweet, out);
  return out;
}

export async function probeMediaUrls(urls, { fetchImpl = fetch, allow = isTweetCdnMedia } = {}) {
  const kept = [];
  for (const u of urls) {
    if (!allow(u)) continue;
    try {
      const res = await fetchImpl(u, { method: "HEAD", redirect: "follow" });
      if (res.ok || (res.status >= 300 && res.status < 400)) {
        kept.push(u);
        continue;
      }
      if (res.status === 403 || res.status === 405 || res.status === 400) {
        const get = await fetchImpl(u, { method: "GET", redirect: "follow" });
        if (get.ok) kept.push(u);
      }
    } catch {
      /* omit — do not substitute */
    }
  }
  return kept;
}
