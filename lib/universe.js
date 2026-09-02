import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function dataFile(name) {
  const candidates = [join(process.cwd(), "data", name), join(ROOT, "data", name)];
  for (const p of candidates) {
    try {
      return readFileSync(p, "utf8");
    } catch {
      /* next */
    }
  }
  throw new Error(`missing data/${name}`);
}

export function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

export function parseCsv(text) {
  const lines = String(text).replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).filter(Boolean).map((line) => {
    const cols = parseCsvLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? "";
    });
    return row;
  });
}

const SKIP_TICKERS = new Set(["S", "IT"]);
const AMBIGUOUS = new Set(["BILL", "TOAST", "NOW", "ARM", "TYL", "SHOP", "UBER"]);

export function loadUniverse(csvText) {
  const rows = parseCsv(csvText);
  const byTicker = new Map();
  const matchers = [];
  const sectors = new Set();
  const subSectors = new Set();

  for (const r of rows) {
    const ticker = String(r.ticker || "").toUpperCase();
    if (!ticker) continue;
    const aliases = String(r.aliases || "")
      .split("|")
      .map((a) => a.trim())
      .filter(Boolean);
    const rec = { ticker, name: r.name || ticker, sector: r.sector || "", aliases };
    byTicker.set(ticker, rec);
    matchers.push({ alias: ticker, ticker, kind: "ticker" });
    if (r.name) matchers.push({ alias: r.name, ticker, kind: "name" });
    for (const a of aliases) matchers.push({ alias: a, ticker, kind: "alias" });
    if (r.sector) sectors.add(r.sector);
    if (r.sub_sector) subSectors.add(r.sub_sector);
  }
  matchers.sort((a, b) => b.alias.length - a.alias.length);
  return { rows, byTicker, matchers, sectors, subSectors };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function consider(seen, found, universe, ticker) {
  let t = String(ticker || "").toUpperCase();
  if (t === "TSMC") t = "TSM";
  if (!t || seen.has(t) || !universe.byTicker.has(t)) return;
  seen.add(t);
  found.push(t);
}

/** Company/ticker hits that are not gazetteer false positives (Bill, IT, Arm, …). */
export function findTickers(text, universe) {
  const found = [];
  const seen = new Set();
  const raw = String(text || "");

  for (const m of raw.matchAll(/\$([A-Za-z]{1,5})\b/g)) {
    consider(seen, found, universe, m[1]);
  }
  for (const m of raw.matchAll(/:([A-Za-z]{1,5})(?:\s+US)?\b/g)) {
    consider(seen, found, universe, m[1]);
  }
  if (/\bTSMC\b/i.test(raw) || /\bTaiwan Semiconductor\b/i.test(raw)) {
    consider(seen, found, universe, "TSM");
  }
  if (/\bCloudflare\b/i.test(raw)) consider(seen, found, universe, "NET");

  for (const { alias, ticker, kind } of universe.matchers) {
    if (seen.has(ticker)) continue;
    const a = String(alias || "").trim();
    if (!a) continue;
    const upper = a.toUpperCase();
    if (SKIP_TICKERS.has(upper)) continue;

    const isSymbol = kind === "ticker" || /^[A-Z0-9.]{1,5}$/.test(a);
    if (isSymbol) {
      if (AMBIGUOUS.has(ticker)) {
        if (!new RegExp(`(?:^|[^A-Za-z])\\$${ticker}(?:[^A-Za-z]|$)`).test(raw)) {
          if (!new RegExp(`(?:^|[^A-Za-z])${ticker}(?:[^A-Za-z]|$)`).test(raw)) continue;
        }
      } else {
        const re = new RegExp(`(?:^|[^A-Za-z0-9])${escapeRe(a)}(?:[^A-Za-z0-9]|$)`, "i");
        if (!re.test(raw)) continue;
      }
    } else {
      if (a.length < 4) continue;
      if (AMBIGUOUS.has(ticker) && a.length < 10) continue;
      const re = new RegExp(`(?:^|[^A-Za-z])${escapeRe(a)}(?:[^A-Za-z]|$)`, "i");
      if (!re.test(raw)) continue;
    }
    consider(seen, found, universe, ticker);
  }
  return found;
}

export function categoryForTickers(tickers) {
  if (!tickers.length) return null;
  return `:${tickers[0]} US`;
}

export function findSectorHits(text, universe) {
  const raw = String(text || "");
  const hits = [];
  const labels = [...(universe?.sectors || []), ...(universe?.subSectors || [])];
  for (const s of labels) {
    if (!s || String(s).length < 5) continue;
    const re = new RegExp(`(?:^|[^A-Za-z])${escapeRe(s)}(?:[^A-Za-z]|$)`, "i");
    if (re.test(raw) && !hits.includes(s)) hits.push(s);
  }
  return hits;
}
