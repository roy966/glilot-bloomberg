const SEARCH_URL = "https://api.twitterapi.io/twitter/tweet/advanced_search";
const BY_ID_URL = "https://api.twitterapi.io/twitter/tweets";

function authHeaders(apiKey) {
  return { "X-API-Key": apiKey };
}

export function searchUrl(query, cursor = "") {
  const params = new URLSearchParams({ query, queryType: "Latest" });
  if (cursor) params.set("cursor", cursor);
  return `${SEARCH_URL}?${params.toString()}`;
}

async function readJson(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export async function advancedSearch({ apiKey, query, cursor = "", fetchImpl = fetch }) {
  if (!apiKey) {
    const err = new Error("missing key");
    err.code = "NO_KEY";
    throw err;
  }
  const res = await fetchImpl(searchUrl(query, cursor), {
    method: "GET",
    headers: authHeaders(apiKey),
  });
  const body = await readJson(res);
  if (!res.ok) {
    const err = new Error(`twitterapi.io HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return {
    tweets: Array.isArray(body?.tweets) ? body.tweets : [],
    has_next_page: Boolean(body?.has_next_page),
    next_cursor: body?.next_cursor || "",
  };
}

export async function tweetsByIds({ apiKey, ids, fetchImpl = fetch }) {
  if (!apiKey) {
    const err = new Error("missing key");
    err.code = "NO_KEY";
    throw err;
  }
  const list = [...new Set(ids.map(String).filter(Boolean))];
  if (!list.length) return [];
  const params = new URLSearchParams({ tweet_ids: list.join(",") });
  const res = await fetchImpl(`${BY_ID_URL}?${params}`, {
    method: "GET",
    headers: authHeaders(apiKey),
  });
  const body = await readJson(res);
  if (!res.ok) {
    const err = new Error(`twitterapi.io HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return Array.isArray(body?.tweets) ? body.tweets : [];
}
