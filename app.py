"""Glilot Bloomberg — Streamlit X/Twitter news portal.

Seed-only. No Twitter/X API keys. Root app.py for Streamlit Community Cloud.
"""

from __future__ import annotations

import html
import json
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
import streamlit as st
import streamlit.components.v1 as components

ROOT = Path(__file__).resolve().parent
TZ = ZoneInfo("Asia/Jerusalem")
SECTORS = [
    "Vertical SW",
    "Horizontal SW",
    "Pure Cyber",
    "Cyber Related",
    "SI",
    "Semis & HW",
    "Emerging Tech",
]
THEMES = ["AI", "ROBOTICS", "SPACE", "CYBER", "CHIPS", "MACRO"]

st.set_page_config(
    page_title="GLILOT · X NEWS",
    page_icon="⬛",
    layout="wide",
    initial_sidebar_state="collapsed",
)


def _css() -> str:
    return (ROOT / "static" / "bloomberg.css").read_text()


@st.cache_data(show_spinner=False)
def load_universe() -> pd.DataFrame:
    df = pd.read_csv(ROOT / "data" / "universe.csv")
    df["aliases"] = df["aliases"].fillna("").astype(str)
    return df


@st.cache_data(show_spinner=False)
def load_tweets_raw() -> list[dict]:
    return json.loads((ROOT / "data" / "tweets.json").read_text())


def materialize(raw: list[dict], now: datetime) -> pd.DataFrame:
    rows = []
    for t in raw:
        ts = now - timedelta(minutes=int(t["offset_minutes"]))
        rows.append(
            {
                **t,
                "ts": ts,
                "tickers": list(t.get("tickers") or []),
                "themes": list(t.get("themes") or []),
                "sectors": list(t.get("sectors") or []),
                "media": list(t.get("media") or []),
            }
        )
    df = pd.DataFrame(rows)
    df["ts"] = pd.to_datetime(df["ts"], utc=False)
    return df.sort_values("ts", ascending=False).reset_index(drop=True)


def fmt_time(ts: datetime, now: datetime) -> str:
    local = ts.astimezone(TZ) if ts.tzinfo else ts.replace(tzinfo=TZ)
    nloc = now.astimezone(TZ)
    if local.date() == nloc.date():
        return local.strftime("%H:%M")
    return local.strftime("%m/%d")


def alias_map(universe: pd.DataFrame) -> dict[str, str]:
    m: dict[str, str] = {}
    for _, r in universe.iterrows():
        ticker = str(r["ticker"]).upper()
        m[ticker] = ticker
        for a in str(r["aliases"]).split("|"):
            a = a.strip()
            if a:
                m[a.upper()] = ticker
    m["TSMC"] = "TSM"
    m["TAIWAN SEMICONDUCTOR"] = "TSM"
    m["CLOUDFLARE"] = "NET"
    return m


def resolve_ticker_query(q: str, amap: dict[str, str]) -> str | None:
    q = (q or "").strip().upper().lstrip(":")
    if q.endswith(" US"):
        q = q[:-3]
    q = q.strip()
    if not q:
        return None
    return amap.get(q, q)


def apply_filters(
    df: pd.DataFrame,
    *,
    now: datetime,
    keyword: str,
    handle: str,
    ticker_q: str,
    amap: dict[str, str],
    sectors: list[str],
    themes: list[str],
    time_range: str,
    has_media: bool,
    universe_only: bool,
) -> pd.DataFrame:
    out = df
    if keyword:
        k = keyword.lower()
        mask = (
            out["summary"].str.lower().str.contains(k, regex=False)
            | out["full_text"].str.lower().str.contains(k, regex=False)
            | out["source"].str.lower().str.contains(k, regex=False)
            | out["handle"].str.lower().str.contains(k, regex=False)
            | out["category"].str.lower().str.contains(k, regex=False)
        )
        out = out[mask]
    if handle:
        h = handle.lower().lstrip("@")
        out = out[
            out["source"].str.lower().str.contains(h, regex=False)
            | out["handle"].str.lower().str.contains(h, regex=False)
        ]
    if ticker_q:
        resolved = resolve_ticker_query(ticker_q, amap)
        if resolved:
            r = resolved.upper()

            def _has_ticker(xs, cat: str) -> bool:
                ticks = [str(x).upper() for x in xs]
                if r in ticks:
                    return True
                c = (cat or "").upper().strip()
                return c == f":{r} US" or c == f":{r}"

            out = out[
                [
                    _has_ticker(xs, cat)
                    for xs, cat in zip(out["tickers"], out["category"])
                ]
            ]
    if sectors:
        want = set(sectors)
        out = out[out["sectors"].apply(lambda xs: bool(want.intersection(xs)))]
    if themes:
        want = set(themes)
        out = out[out["themes"].apply(lambda xs: bool(want.intersection(xs)))]
    nloc = now.astimezone(TZ)
    if time_range == "TODAY":
        start = nloc.replace(hour=0, minute=0, second=0, microsecond=0)
        out = out[out["ts"] >= start]
    elif time_range == "24H":
        out = out[out["ts"] >= now - timedelta(hours=24)]
    else:
        out = out[out["ts"] >= now - timedelta(days=7)]
    if has_media:
        out = out[out["has_media"] == True]  # noqa: E712
    if universe_only:
        out = out[out["in_universe"] == True]  # noqa: E712
    return out.reset_index(drop=True)


def feed_html(df: pd.DataFrame, now: datetime, selected_id: str) -> str:
    rows = []
    for _, r in df.iterrows():
        tid = str(r["id"])
        klass = "row"
        if r.get("top"):
            klass += " top"
        if tid == selected_id:
            klass += " sel"
        tdisp = fmt_time(r["ts"].to_pydatetime(), now)
        tweet = html.escape(str(r["summary"]))
        cat = html.escape(str(r["category"]))
        src = html.escape(str(r["source"]))
        cat_cls = "theme" if " US" not in str(r["category"]) else "tkr"
        perm = html.escape(str(r["permalink"]), quote=True)
        rows.append(
            f'<a class="{klass}" href="?sel={html.escape(tid, quote=True)}" target="_parent" '
            f'data-id="{html.escape(tid, quote=True)}" data-permalink="{perm}">'
            f'<span class="c-time">{tdisp}</span>'
            f'<span class="c-tweet">{tweet}</span>'
            f'<span class="c-cat {cat_cls}">{cat}</span>'
            f'<span class="c-src">{src}</span>'
            f"</a>"
        )
    ids_js = json.dumps([str(i) for i in df["id"].tolist()])
    sel_js = json.dumps(selected_id or "")
    table = "\n".join(rows) or '<div class="empty">NO ITEMS MATCH FILTERS</div>'
    return f"""<!DOCTYPE html>
<html><head>
<meta charset="utf-8"/>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Condensed:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  html,body {{ margin:0; padding:0; background:#000; color:#ffb000;
    font-family:"IBM Plex Sans Condensed","Arial Narrow",sans-serif; }}
  .head {{ display:grid; grid-template-columns:52px 1fr 92px 118px; gap:0;
    border-bottom:1px solid #ff9900; color:#c47a00; font-size:10px; letter-spacing:.14em;
    text-transform:uppercase; padding:2px 6px; position:sticky; top:0; background:#000; z-index:2; }}
  .row {{ display:grid; grid-template-columns:52px 1fr 92px 118px; gap:0;
    padding:1px 6px; text-decoration:none; color:#ffb000; border-bottom:1px solid #161000;
    line-height:1.28; font-size:12.5px; }}
  .row:hover {{ background:#1a1200; }}
  .row.sel {{ background:#2a1800; box-shadow:inset 3px 0 0 #ff9900; }}
  .row.top .c-tweet {{ color:#ffe100; font-weight:600; }}
  .c-time {{ color:#ff9900; font-variant-numeric:tabular-nums; }}
  .c-tweet {{ white-space:nowrap; overflow:hidden; text-overflow:ellipsis; padding-right:8px; }}
  .c-cat {{ letter-spacing:.04em; font-weight:600; }}
  .c-cat.tkr {{ color:#ff9900; }}
  .c-cat.theme {{ color:#ff6a00; }}
  .c-src {{ color:#c47a00; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }}
  .empty {{ padding:8px; color:#8a5a00; letter-spacing:.1em; font-size:11px; }}
</style></head>
<body tabindex="0">
<div class="head"><span>Time</span><span>Tweet</span><span>Category</span><span>Source</span></div>
{table}
<script>
const IDS = {ids_js};
let sel = {sel_js};
function go(id) {{
  const url = new URL(window.parent.location.href);
  url.searchParams.set('sel', id);
  window.parent.location = url.toString();
}}
function openX() {{
  const a = document.querySelector('.row.sel');
  if (!a) return;
}}
document.addEventListener('keydown', (e) => {{
  if (!IDS.length) return;
  let i = Math.max(0, IDS.indexOf(sel));
  if (e.key === 'j' || e.key === 'ArrowDown') {{
    e.preventDefault();
    go(IDS[Math.min(IDS.length-1, i+1)]);
  }} else if (e.key === 'k' || e.key === 'ArrowUp') {{
    e.preventDefault();
    go(IDS[Math.max(0, i-1)]);
  }} else if (e.key === 'Enter' || e.key === 'o') {{
    e.preventDefault();
    const row = document.querySelector('.row.sel') || document.querySelector('.row');
    if (row) window.parent.open(row.getAttribute('data-permalink') || '', '_blank');
  }} else if (e.key === 'Home') {{ e.preventDefault(); go(IDS[0]); }}
  else if (e.key === 'End') {{ e.preventDefault(); go(IDS[IDS.length-1]); }}
}});
document.body.focus();
const selEl = document.querySelector('.row.sel');
if (selEl) selEl.scrollIntoView({{block:'nearest'}});
</script>
</body></html>"""


def main() -> None:
    st.markdown(f"<style>{_css()}</style>", unsafe_allow_html=True)
    now = datetime.now(TZ)
    universe = load_universe()
    amap = alias_map(universe)
    df = materialize(load_tweets_raw(), now)

    qp = st.query_params
    selected = qp.get("sel", "")

    nloc = now.astimezone(TZ)
    st.markdown(
        f"""<div class="bb-top">
          <span class="bb-brand">GLILOT HF</span>
          <span class="bb-sep">│</span>
          <span class="bb-meta">X / NEWS</span>
          <span class="bb-sep">│</span>
          <span class="bb-meta">IST {nloc.strftime('%H:%M:%S')}</span>
          <span class="bb-sep">│</span>
          <span class="bb-dim">J/K MOVE · ENTER OPEN X · SEED FEED</span>
        </div>""",
        unsafe_allow_html=True,
    )

    r1 = st.columns([2.2, 1.6, 1.3, 1.6, 0.9, 0.95])
    with r1[0]:
        keyword = st.text_input("KEYWORD", placeholder="search", label_visibility="visible")
    with r1[1]:
        handle = st.text_input("HANDLE / SOURCE", placeholder="SemiAnalysis", label_visibility="visible")
    with r1[2]:
        ticker_q = st.text_input("TICKER", placeholder="TSMC / NVDA", label_visibility="visible")
    with r1[3]:
        time_range = st.radio(
            "TIME",
            ["TODAY", "24H", "7D"],
            index=2,
            horizontal=True,
            label_visibility="visible",
        )
    with r1[4]:
        has_media = st.checkbox("HAS CHART/MEDIA", value=False)
    with r1[5]:
        universe_only = st.checkbox("UNIVERSE ONLY", value=False)

    sectors = st.pills("SECTORS", SECTORS, selection_mode="multi", default=[], label_visibility="visible")
    themes = st.pills("THEMES", [f":{t}" for t in THEMES], selection_mode="multi", default=[], label_visibility="visible")
    theme_vals = [t.lstrip(":") for t in (themes or [])]

    filtered = apply_filters(
        df,
        now=now,
        keyword=keyword or "",
        handle=handle or "",
        ticker_q=ticker_q or "",
        amap=amap,
        sectors=list(sectors or []),
        themes=theme_vals,
        time_range=time_range,
        has_media=has_media,
        universe_only=universe_only,
    )

    ids = filtered["id"].astype(str).tolist()
    if selected not in ids:
        selected = ids[0] if ids else ""
        if selected:
            st.query_params["sel"] = selected

    n = len(filtered)
    n_uni = int(filtered["in_universe"].sum()) if n else 0
    n_media = int(filtered["has_media"].sum()) if n else 0
    st.markdown(
        f'<div class="bb-dim">{n} ITEMS&nbsp;&nbsp;·&nbsp;&nbsp;UNIVERSE {n_uni}'
        f'&nbsp;&nbsp;·&nbsp;&nbsp;MEDIA {n_media}&nbsp;&nbsp;·&nbsp;&nbsp;'
        f'CLOSE-WATCH {len(universe)}</div>',
        unsafe_allow_html=True,
    )

    feed = feed_html(filtered, now, selected)
    height = min(560, 28 + max(n, 1) * 20)
    components.html(feed, height=height, scrolling=True)

    if selected and n:
        row = filtered[filtered["id"] == selected]
        if row.empty:
            row = filtered.iloc[[0]]
        r = row.iloc[0]
        tdisp = fmt_time(r["ts"].to_pydatetime(), now)
        ticks = " ".join(f":{t} US" for t in r["tickers"]) or "—"
        th = " ".join(f":{t}" for t in r["themes"]) or "—"
        sec = ", ".join(r["sectors"]) or "theme"
        uni = "Y" if r["in_universe"] else "N"
        left, right = st.columns([1.25, 1])
        with left:
            st.markdown(
                f"""<div class="bb-detail">
                <h3>{html.escape(str(r['category']))} · {html.escape(str(r['source']))} · {tdisp}</h3>
                <div class="bb-kvs">@{html.escape(str(r['handle']))} · TICKERS {html.escape(ticks)} · THEMES {html.escape(th)} · {html.escape(sec)} · UNIVERSE {uni}</div>
                <p class="full">{html.escape(str(r['full_text']))}</p>
                <a href="{html.escape(str(r['permalink']), quote=True)}" target="_blank" rel="noopener">OPEN ON X ↗ {html.escape(str(r['permalink']))}</a>
                </div>""",
                unsafe_allow_html=True,
            )
        with right:
            media = list(r["media"] or [])
            if media:
                for m in media:
                    p = ROOT / m
                    if p.exists():
                        st.image(str(p), use_container_width=True)
            else:
                st.markdown(
                    '<div class="bb-detail"><div class="bb-kvs">NO EMBEDDED CHART / IMAGE</div></div>',
                    unsafe_allow_html=True,
                )


if __name__ == "__main__":
    main()
