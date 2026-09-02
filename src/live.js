const REQUIRED = [
  "id",
  "time",
  "summary",
  "full_text",
  "handle",
  "source",
  "category",
  "permalink",
  "media",
  "top",
];

export function rowKind(row) {
  return row?.kind === "substack" ? "substack" : "x";
}

/** Live hover media for X: tweet CDN only. Never seed SVGs /charts/. */
export function isTweetCdnMedia(u) {
  if (typeof u !== "string" || !/^https:\/\//i.test(u)) return false;
  if (/static\/charts|\/charts\//i.test(u)) return false;
  return /pbs\.twimg\.com|video\.twimg\.com|ton\.twitter\.com/i.test(u);
}

/** Live hover media for Substack: that post’s https images. Never seed SVGs. */
export function isSubstackMedia(u) {
  if (typeof u !== "string" || !/^https:\/\//i.test(u)) return false;
  if (/static\/charts|\/charts\//i.test(u)) return false;
  let host = "";
  try {
    host = new URL(u).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (/substackcdn\.com$|\.substack\.com$|substack-post-media\.s3\.amazonaws\.com$|\.wp\.com$/i.test(host)) {
    return true;
  }
  return /\.(png|jpe?g|gif|webp)(?:$|\?)/i.test(u);
}

export function isLiveMediaUrl(u, kind) {
  return kind === "substack" ? isSubstackMedia(u) : isTweetCdnMedia(u);
}

export function permalinkMatches(row) {
  const kind = rowKind(row);
  if (kind === "substack") return substackPermalinkOk(row);
  return xPermalinkOk(row);
}

function xPermalinkOk(row) {
  const id = String(row?.id ?? "");
  const handle = String(row?.handle ?? "").replace(/^@/, "");
  const permalink = String(row?.permalink ?? "");
  if (!id || !/^\d+$/.test(id) || !handle || !permalink) return false;
  let url;
  try {
    url = new URL(permalink);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.hostname !== "x.com") return false;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 3) return false;
  if (parts[1] !== "status") return false;
  if (parts[2] !== id) return false;
  return parts[0].toLowerCase() === handle.toLowerCase();
}

export function substackPermalinkOk(row) {
  const id = String(row?.id ?? "").trim();
  const permalink = String(row?.permalink ?? "").trim();
  if (!id || !permalink) return false;
  let url;
  try {
    url = new URL(permalink);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.hostname === "x.com" || url.hostname === "twitter.com") return false;
  const slug = id.includes(":") ? id.slice(id.lastIndexOf(":") + 1) : id;
  if (!slug || slug.length < 2) return false;
  const hay = `${url.pathname}${url.search} ${permalink}`;
  return hay.toLowerCase().includes(String(slug).toLowerCase());
}

export function mediaUrlsOk(media, kind = "x") {
  if (!Array.isArray(media)) return false;
  return media.every((u) => isLiveMediaUrl(u, kind));
}

export function mixesSeedCharts(row) {
  const media = row?.media;
  if (!Array.isArray(media)) return true;
  return media.some((u) => /static\/charts|\/charts\//i.test(String(u)));
}

export function isLiveRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;
  for (const k of REQUIRED) {
    if (!(k in row)) return false;
  }
  const kind = rowKind(row);
  if (row.kind != null && row.kind !== "x" && row.kind !== "substack") return false;
  if (typeof row.id !== "string" || !row.id.trim()) return false;
  if (kind === "x" && !/^\d+$/.test(row.id)) return false;
  if (typeof row.time !== "string" || Number.isNaN(new Date(row.time).getTime())) return false;
  if (typeof row.summary !== "string" || !row.summary.trim()) return false;
  if (typeof row.full_text !== "string" || !row.full_text.trim()) return false;
  if (typeof row.handle !== "string" || !row.handle.trim()) return false;
  if (typeof row.source !== "string" || !row.source.trim()) return false;
  if (typeof row.category !== "string" || !row.category.trim()) return false;
  if (typeof row.top !== "boolean") return false;
  if (!permalinkMatches(row)) return false;
  if (mixesSeedCharts(row)) return false;
  if (!mediaUrlsOk(row.media, kind)) return false;
  return true;
}

/** True when `data` is a non-empty array of well-formed live rows. */
export function isWellFormedLiveFeed(data) {
  return Array.isArray(data) && data.length > 0 && data.every(isLiveRow);
}
