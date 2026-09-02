import { permalinkMatches } from "../src/live.js";

export function buildPermalink(handle, id) {
  const h = String(handle || "").replace(/^@/, "").trim();
  const i = String(id || "").trim();
  return `https://x.com/${h}/status/${i}`;
}

function statusFromPermalink(htmlOrUrl, id, handle) {
  const s = String(htmlOrUrl || "");
  if (!s.includes(String(id))) return false;
  if (handle && !s.toLowerCase().includes(String(handle).toLowerCase())) return false;
  return true;
}

/** Verify https://x.com/{handle}/status/{id} is that tweet. Never logs secrets. */
export async function verifyPermalink(handle, id, { fetchImpl = fetch, getById } = {}) {
  const hid = String(id || "").trim();
  const user = String(handle || "").replace(/^@/, "").trim();
  if (!hid || !/^\d+$/.test(hid) || !user) {
    return { ok: false, reason: "missing-id" };
  }
  const permalink = buildPermalink(user, hid);
  if (!permalinkMatches({ id: hid, handle: user, permalink })) {
    return { ok: false, reason: "bad-shape" };
  }

  try {
    const oembed = `https://publish.twitter.com/oembed?url=${encodeURIComponent(permalink)}`;
    const res = await fetchImpl(oembed, { redirect: "follow" });
    if (res.status === 404) return { ok: false, reason: "404" };
    if (res.ok) {
      const body = await res.json().catch(() => null);
      const blob = `${body?.html || ""} ${body?.url || ""} ${body?.author_url || ""}`;
      if (blob.includes(hid) && statusFromPermalink(blob, hid, user)) {
        return { ok: true, permalink, via: "oembed" };
      }
      if (String(body?.url || "").includes(`/status/${hid}`)) {
        const author = String(body?.author_url || "").toLowerCase();
        if (!author || author.includes(`/${user.toLowerCase()}`)) {
          return { ok: true, permalink, via: "oembed" };
        }
        return { ok: false, reason: "not-that-tweet" };
      }
      return { ok: false, reason: "not-that-tweet" };
    }
  } catch {
    /* try next */
  }

  try {
    const res = await fetchImpl(
      `https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(hid)}&lang=en`,
      { redirect: "follow" },
    );
    if (res.status === 404) return { ok: false, reason: "404" };
    if (res.ok) {
      const body = await res.json().catch(() => null);
      const sid = String(body?.id_str || body?.id || "");
      const screen =
        body?.user?.screen_name || body?.author?.userName || body?.user?.screenName || "";
      if (sid === hid) {
        if (screen && String(screen).toLowerCase() !== user.toLowerCase()) {
          return { ok: false, reason: "not-that-tweet" };
        }
        return { ok: true, permalink, via: "syndication" };
      }
      if (sid) return { ok: false, reason: "not-that-tweet" };
    }
  } catch {
    /* try next */
  }

  if (typeof getById === "function") {
    try {
      const t = await getById(hid);
      if (!t) return { ok: false, reason: "missing-id" };
      if (String(t.id) !== hid) return { ok: false, reason: "not-that-tweet" };
      const apiUser = String(t.author?.userName || "").replace(/^@/, "");
      if (apiUser && apiUser.toLowerCase() !== user.toLowerCase()) {
        return { ok: false, reason: "not-that-tweet" };
      }
      return { ok: true, permalink, via: "tweet-by-id" };
    } catch {
      return { ok: false, reason: "unverified" };
    }
  }

  return { ok: false, reason: "unverified" };
}
