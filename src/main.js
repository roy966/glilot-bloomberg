import "./style.css";
import { isWellFormedLiveFeed, isLiveMediaUrl } from "./live.js";

const TZ = "Asia/Jerusalem";
const SECTORS = [
  "Vertical SW",
  "Horizontal SW",
  "Pure Cyber",
  "Cyber Related",
  "SI",
  "Semis & HW",
  "Emerging Tech",
];
const THEMES = ["AI", "ROBOTICS", "SPACE", "CYBER", "CHIPS", "MACRO"];

const state = {
  keyword: "",
  handle: "",
  ticker: "",
  time: "7D",
  hasMedia: false,
  universeOnly: false,
  sectors: new Set(),
  themes: new Set(),
  selectedId: new URLSearchParams(location.search).get("sel") || "",
  hoverId: "",
};

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);

function parseCsvLine(line) {
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

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
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

function aliasMap(universe) {
  const m = {};
  for (const r of universe) {
    const ticker = String(r.ticker || "").toUpperCase();
    if (!ticker) continue;
    m[ticker] = ticker;
    for (const a of String(r.aliases || "").split("|")) {
      const k = a.trim().toUpperCase();
      if (k) m[k] = ticker;
    }
  }
  m.TSMC = "TSM";
  m["TAIWAN SEMICONDUCTOR"] = "TSM";
  m.CLOUDFLARE = "NET";
  return m;
}

function resolveTicker(q, amap) {
  let s = (q || "").trim().toUpperCase().replace(/^:/, "");
  if (s.endsWith(" US")) s = s.slice(0, -3);
  s = s.trim();
  if (!s) return null;
  return amap[s] || s;
}

function nowTz() {
  return new Date();
}

function fmtClock(d) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
}

function fmtTime(ts, now) {
  const dateFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const timeFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const today = dateFmt.format(now);
  const day = dateFmt.format(ts);
  if (day === today) return timeFmt.format(ts);
  const [, m, d] = day.split("-");
  return `${m}/${d}`;
}

function startOfToday(now) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const num = (t) => Number(parts.find((p) => p.type === t).value);
  const ms =
    (num("hour") * 3600 + num("minute") * 60 + num("second")) * 1000 +
    now.getMilliseconds();
  return new Date(now.getTime() - ms);
}

function parseTs(t, now) {
  if (t.time) {
    const d = new Date(t.time);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (t.ts) {
    const d = new Date(t.ts);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date(now.getTime() - Number(t.offset_minutes || 0) * 60 * 1000);
}

function rewriteMedia(p, source, kind) {
  const s = String(p || "");
  if (source === "live") return isLiveMediaUrl(s, kind || "x") ? s : "";
  if (/^https?:\/\//i.test(s)) return s;
  return "/" + s.replace(/^static\//, "");
}

function materialize(raw, now, source) {
  return raw
    .map((t) => {
      const media = (t.media || []).map((p) => rewriteMedia(p, source, t.kind)).filter(Boolean);
      const tickers = t.tickers || [];
      return {
        ...t,
        ts: parseTs(t, now),
        tickers,
        themes: t.themes || [],
        sectors: t.sectors || [],
        media,
        has_media: t.has_media ?? media.length > 0,
        in_universe: t.in_universe ?? tickers.length > 0,
      };
    })
    .sort((a, b) => b.ts - a.ts);
}

function applyFilters(rows, now, amap) {
  let out = rows;
  const k = state.keyword.trim().toLowerCase();
  if (k) {
    out = out.filter((r) =>
      [r.summary, r.full_text, r.source, r.handle, r.category]
        .join("\n")
        .toLowerCase()
        .includes(k),
    );
  }
  const h = state.handle.trim().toLowerCase().replace(/^@/, "");
  if (h) {
    out = out.filter(
      (r) =>
        r.source.toLowerCase().includes(h) || r.handle.toLowerCase().includes(h),
    );
  }
  if (state.ticker.trim()) {
    const resolved = resolveTicker(state.ticker, amap);
    if (resolved) {
      out = out.filter((r) => {
        const ticks = (r.tickers || []).map((x) => String(x).toUpperCase());
        if (ticks.includes(resolved)) return true;
        const c = String(r.category || "").toUpperCase().trim();
        return c === `:${resolved} US` || c === `:${resolved}`;
      });
    }
  }
  if (state.sectors.size) {
    out = out.filter((r) => r.sectors.some((s) => state.sectors.has(s)));
  }
  if (state.themes.size) {
    out = out.filter((r) => r.themes.some((t) => state.themes.has(t)));
  }
  if (state.time === "TODAY") {
    const start = startOfToday(now);
    out = out.filter((r) => r.ts >= start);
  } else if (state.time === "24H") {
    out = out.filter((r) => r.ts >= new Date(now.getTime() - 24 * 3600 * 1000));
  } else {
    out = out.filter((r) => r.ts >= new Date(now.getTime() - 7 * 24 * 3600 * 1000));
  }
  if (state.hasMedia) out = out.filter((r) => r.has_media);
  if (state.universeOnly) out = out.filter((r) => r.in_universe);
  return out;
}

function mediaSrc(p) {
  const s = String(p || "");
  if (/^https?:\/\//i.test(s)) return s;
  return s.startsWith("/") ? s : `/${s}`;
}

function renderPills() {
  $("sectors").innerHTML =
    `<span class="pill-lab">SECTORS</span>` +
    SECTORS.map(
      (s) =>
        `<button type="button" data-sector="${esc(s)}" class="${state.sectors.has(s) ? "on" : ""}">${esc(s)}</button>`,
    ).join("");
  $("themes").innerHTML =
    `<span class="pill-lab">THEMES</span>` +
    THEMES.map(
      (t) =>
        `<button type="button" data-theme="${t}" class="${state.themes.has(t) ? "on" : ""}">:${t}</button>`,
    ).join("");
}

function renderFeed(filtered, now) {
  if (!filtered.length) {
    $("feed").innerHTML = `<div class="empty">NO ITEMS MATCH FILTERS</div>`;
    return;
  }
  $("feed").innerHTML = filtered
    .map((r) => {
      const sel = r.id === state.selectedId ? " sel" : "";
      const top = r.top ? " top" : "";
      const catCls = String(r.category).includes(" US") ? "tkr" : "theme";
      return `<div class="row${top}${sel}" data-id="${esc(r.id)}" data-permalink="${esc(r.permalink)}">
        <span class="c-time">${esc(fmtTime(r.ts, now))}</span>
        <span class="c-tweet">${esc(r.summary)}</span>
        <span class="c-cat ${catCls}">${esc(r.category)}</span>
        <span class="c-src">${esc(r.source)}</span>
      </div>`;
    })
    .join("");
}

function renderDetail(row) {
  const el = $("detail");
  if (!row) {
    el.innerHTML = `<div class="no-media">SELECT A ROW</div>`;
    return;
  }
  const ticks = (row.tickers || []).map((t) => `:${t} US`).join(" ") || "—";
  const th = (row.themes || []).map((t) => `:${t}`).join(" ") || "—";
  const sec = (row.sectors || []).join(", ") || "theme";
  const charts = (row.media || [])
    .map(
      (m) =>
        `<img src="${esc(mediaSrc(m))}" alt="embedded chart from tweet" />`,
    )
    .join("");
  el.innerHTML = `
    <div>
      <h3>${esc(row.category)} · ${esc(row.source)} · ${esc(fmtTime(row.ts, nowTz()))}</h3>
      <div class="kvs">@${esc(row.handle)} · TICKERS ${esc(ticks)} · THEMES ${esc(th)} · ${esc(sec)} · UNIVERSE ${row.in_universe ? "Y" : "N"}</div>
      <p class="full">${esc(row.full_text)}</p>
      <a href="${esc(row.permalink)}" target="_blank" rel="noopener">OPEN ON X ↗ ${esc(row.permalink)}</a>
    </div>
    <div class="charts">${charts || `<div class="no-media">NO EMBEDDED CHART / IMAGE</div>`}</div>`;
  el.querySelectorAll(".charts img").forEach((img) => {
    img.addEventListener("error", () => {
      const wrap = img.closest(".charts");
      img.remove();
      if (wrap && !wrap.querySelector("img")) {
        wrap.innerHTML = `<div class="no-media">NO EMBEDDED CHART / IMAGE</div>`;
      }
    });
  });
}

function setSelParam(id) {
  const url = new URL(location.href);
  if (id) url.searchParams.set("sel", id);
  else url.searchParams.delete("sel");
  history.replaceState(null, "", url);
}

let ALL = [];
let AMAP = {};
let UNIVERSE_N = 0;

function refresh() {
  const now = nowTz();
  $("clock").textContent = `IST ${fmtClock(now)}`;
  const filtered = applyFilters(ALL, now, AMAP);
  if (state.selectedId && !filtered.some((r) => r.id === state.selectedId)) {
    state.selectedId = filtered[0]?.id || "";
    setSelParam(state.selectedId);
  }
  const nUni = filtered.filter((r) => r.in_universe).length;
  const nMedia = filtered.filter((r) => r.has_media).length;
  $("counts").textContent = `${filtered.length} ITEMS   ·   UNIVERSE ${nUni}   ·   MEDIA ${nMedia}   ·   CLOSE-WATCH ${UNIVERSE_N}`;
  renderFeed(filtered, now);
  const row =
    filtered.find((r) => r.id === (state.hoverId || state.selectedId)) ||
    filtered[0] ||
    null;
  renderDetail(row);
}

function bind() {
  $("keyword").addEventListener("input", (e) => {
    state.keyword = e.target.value;
    refresh();
  });
  $("handle").addEventListener("input", (e) => {
    state.handle = e.target.value;
    refresh();
  });
  $("ticker").addEventListener("input", (e) => {
    state.ticker = e.target.value;
    refresh();
  });
  document.querySelectorAll("[data-time]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.time = btn.dataset.time;
      document.querySelectorAll("[data-time]").forEach((b) => b.classList.toggle("on", b === btn));
      refresh();
    });
  });
  document.querySelector("[data-flag='media']").addEventListener("click", (e) => {
    state.hasMedia = !state.hasMedia;
    e.currentTarget.classList.toggle("on", state.hasMedia);
    refresh();
  });
  document.querySelector("[data-flag='universe']").addEventListener("click", (e) => {
    state.universeOnly = !state.universeOnly;
    e.currentTarget.classList.toggle("on", state.universeOnly);
    refresh();
  });
  $("sectors").addEventListener("click", (e) => {
    const b = e.target.closest("[data-sector]");
    if (!b) return;
    const s = b.dataset.sector;
    if (state.sectors.has(s)) state.sectors.delete(s);
    else state.sectors.add(s);
    renderPills();
    refresh();
  });
  $("themes").addEventListener("click", (e) => {
    const b = e.target.closest("[data-theme]");
    if (!b) return;
    const t = b.dataset.theme;
    if (state.themes.has(t)) state.themes.delete(t);
    else state.themes.add(t);
    renderPills();
    refresh();
  });
  $("feed").addEventListener("click", (e) => {
    const row = e.target.closest(".row");
    if (!row) return;
    state.selectedId = row.dataset.id;
    state.hoverId = "";
    setSelParam(state.selectedId);
    refresh();
  });
  $("feed").addEventListener("mouseover", (e) => {
    const row = e.target.closest(".row");
    if (!row) return;
    if (state.hoverId === row.dataset.id) return;
    state.hoverId = row.dataset.id;
    const now = nowTz();
    const filtered = applyFilters(ALL, now, AMAP);
    renderDetail(filtered.find((r) => r.id === state.hoverId) || null);
  });
  $("feed").addEventListener("mouseleave", () => {
    state.hoverId = "";
    const now = nowTz();
    const filtered = applyFilters(ALL, now, AMAP);
    renderDetail(filtered.find((r) => r.id === state.selectedId) || filtered[0] || null);
  });
  document.addEventListener("keydown", (e) => {
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;
    const now = nowTz();
    const filtered = applyFilters(ALL, now, AMAP);
    if (!filtered.length) return;
    let i = Math.max(0, filtered.findIndex((r) => r.id === state.selectedId));
    if (e.key === "j" || e.key === "ArrowDown") {
      e.preventDefault();
      i = Math.min(filtered.length - 1, i + 1);
      state.selectedId = filtered[i].id;
      setSelParam(state.selectedId);
      refresh();
      document.querySelector(".row.sel")?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "k" || e.key === "ArrowUp") {
      e.preventDefault();
      i = Math.max(0, i - 1);
      state.selectedId = filtered[i].id;
      setSelParam(state.selectedId);
      refresh();
      document.querySelector(".row.sel")?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" || e.key === "o") {
      e.preventDefault();
      const row = filtered[i];
      if (row?.permalink) window.open(row.permalink, "_blank", "noopener");
    } else if (e.key === "Home") {
      e.preventDefault();
      state.selectedId = filtered[0].id;
      setSelParam(state.selectedId);
      refresh();
    } else if (e.key === "End") {
      e.preventDefault();
      state.selectedId = filtered[filtered.length - 1].id;
      setSelParam(state.selectedId);
      refresh();
    }
  });
}

async function loadTweetRows() {
  try {
    const r = await fetch("/data/live.json");
    if (r.ok) {
      const data = await r.json();
      if (isWellFormedLiveFeed(data)) return { rows: data, source: "live" };
    }
  } catch {
    /* seed */
  }
  const rows = await fetch("/data/tweets.json").then((r) => r.json());
  return { rows, source: "seed" };
}

async function boot() {
  const [{ rows, source }, csv] = await Promise.all([
    loadTweetRows(),
    fetch("/data/universe.csv").then((r) => r.text()),
  ]);
  const universe = parseCsv(csv);
  UNIVERSE_N = universe.length;
  AMAP = aliasMap(universe);
  ALL = materialize(rows, nowTz(), source);
  const mode = $("feed-mode");
  if (mode) {
    mode.textContent =
      source === "live"
        ? "J/K MOVE · ENTER OPEN X · LIVE"
        : "J/K MOVE · ENTER OPEN X · SEED FEED";
  }
  renderPills();
  bind();
  refresh();
  setInterval(() => {
    $("clock").textContent = `IST ${fmtClock(nowTz())}`;
  }, 1000);
}

boot().catch((err) => {
  $("feed").innerHTML = `<div class="empty">LOAD ERROR ${esc(err.message)}</div>`;
});
