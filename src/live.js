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

/** Live hover media: this tweet's CDN URLs only. Never seed SVGs /charts/. */
export function isTweetCdnMedia(u) {
  if (typeof u !== "string" || !/^https:\/\//i.test(u)) return false;
  if (/static\/charts|\/charts\//i.test(u)) return false;
  return /pbs\.twimg\.com|video\.twimg\.com|ton\.twitter\.com/i.test(u);
}

export function permalinkMatches(row) {
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

export function mediaUrlsOk(media) {
  if (!Array.isArray(media)) return false;
  return media.every((u) => isTweetCdnMedia(u));
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
  if (typeof row.id !== "string" || !/^\d+$/.test(row.id)) return false;
  if (typeof row.time !== "string" || Number.isNaN(new Date(row.time).getTime())) return false;
  if (typeof row.summary !== "string" || !row.summary.trim()) return false;
  if (typeof row.full_text !== "string" || !row.full_text.trim()) return false;
  if (typeof row.handle !== "string" || !row.handle.trim()) return false;
  if (typeof row.source !== "string" || !row.source.trim()) return false;
  if (typeof row.category !== "string" || !row.category.trim()) return false;
  if (typeof row.top !== "boolean") return false;
  if (!permalinkMatches(row)) return false;
  if (mixesSeedCharts(row)) return false;
  if (!mediaUrlsOk(row.media)) return false;
  return true;
}

/** True when `data` is a non-empty array of well-formed live rows. */
export function isWellFormedLiveFeed(data) {
  return Array.isArray(data) && data.length > 0 && data.every(isLiveRow);
}
