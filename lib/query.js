/** twitterapi.io advanced_search query packer.
 * since_time:<unix> lives inside `query`, not as its own URL param.
 * Account-list part under ~482; full query including since_time under ~505.
 */

export const ACCOUNT_LIST_MAX = 482;
export const FULL_QUERY_MAX = 505;
export const MAX_HANDLES = 80;

const REPLIES = "";
const SINCE = " since_time:";

export function accountListQuery(handles) {
  const names = uniqueHandles(handles);
  if (!names.length) throw new Error("no handles");
  if (names.length > MAX_HANDLES) {
    throw new Error("refusing oversized handle list");
  }
  return `(${names.map((h) => `from:${h}`).join(" OR ")})`;
}

export function uniqueHandles(handles) {
  const seen = new Set();
  const out = [];
  for (const h of handles) {
    const n = String(h || "")
      .replace(/^@/, "")
      .trim();
    if (!n || seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    out.push(n);
  }
  return out;
}

export function sinceSuffix(sinceUnix) {
  const n = Number(sinceUnix);
  if (!Number.isFinite(n) || n <= 0) throw new Error("invalid since_time");
  return `${REPLIES}${SINCE}${Math.floor(n)}`;
}

export function assertQueryCaps(accountPart, fullQuery) {
  if (accountPart.length > ACCOUNT_LIST_MAX) {
    throw new Error(`account-list query ${accountPart.length} > ${ACCOUNT_LIST_MAX}`);
  }
  if (fullQuery.length > FULL_QUERY_MAX) {
    throw new Error(`full query ${fullQuery.length} > ${FULL_QUERY_MAX}`);
  }
  if (!/\ssince_time:\d+/.test(fullQuery)) {
    throw new Error("since_time missing from query string");
  }
}

export function packBatches(handles, sinceUnix) {
  const suffix = sinceSuffix(sinceUnix);
  const maxAccount = Math.min(ACCOUNT_LIST_MAX, FULL_QUERY_MAX - suffix.length);
  const names = uniqueHandles(handles);
  if (names.length > MAX_HANDLES) throw new Error("refusing oversized handle list");
  const batches = [];
  let current = [];
  const fits = (list) => accountListQuery(list).length <= maxAccount;

  for (const name of names) {
    const trial = [...current, name];
    if (current.length && !fits(trial)) {
      batches.push(current);
      current = [name];
      if (!fits(current)) throw new Error(`handle ${name} alone exceeds query cap`);
    } else if (!fits(trial)) {
      throw new Error(`handle ${name} alone exceeds query cap`);
    } else {
      current = trial;
    }
  }
  if (current.length) batches.push(current);

  return batches.map((hs) => {
    const accountPart = accountListQuery(hs);
    const query = `${accountPart}${suffix}`;
    assertQueryCaps(accountPart, query);
    return { handles: hs, accountPart, query };
  });
}

export const MAX_LOOKBACK_SEC = 12 * 3600;
export const FIRST_LOOKBACK_SEC = 12 * 3600;
export const SKEW_SEC = 120;

export function sinceUnixSeconds(nowSec, lastIngestUnix) {
  const now = Math.floor(Number(nowSec));
  let lookback;
  if (lastIngestUnix && Number(lastIngestUnix) > 0) {
    lookback = now - Math.floor(Number(lastIngestUnix)) + SKEW_SEC;
    lookback = Math.min(MAX_LOOKBACK_SEC, Math.max(60, lookback));
  } else {
    lookback = FIRST_LOOKBACK_SEC;
  }
  return now - lookback;
}
