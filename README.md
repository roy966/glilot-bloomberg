# Glilot Bloomberg

Dense Bloomberg Terminal-style **X / Twitter news** portal for HF Glilot. Black/amber, four columns, combinable filters, seed feed. No Twitter API keys — ever.

Live path: this repo’s root `app.py` is Streamlit Community Cloud ready (zero config).

## Open the feed

**Local**

```bash
python3 -m pip install -r requirements.txt
streamlit run app.py
```

Timezone for “today” / clock is **Asia/Jerusalem**.

**Public URL (Streamlit Cloud)** — one GitHub login, then bookmark `*.streamlit.app`

1. Sign in at [share.streamlit.io](https://share.streamlit.io) with GitHub (grant **private repo** access — this repo is private).
2. Deploy with this pre-filled link (repo, `main`, `app.py`):

   [Deploy glilot-bloomberg to Streamlit Community Cloud](https://share.streamlit.io/deploy?repository=roy966/glilot-bloomberg&branch=main&mainModule=app.py)

3. After deploy, set the app public if you want a one-click bookmark for anyone (private GitHub repo can still host a public app). Optional custom subdomain: `glilot-bloomberg.streamlit.app` in app settings.

Until that login is completed, there is no `*.streamlit.app` URL. Do not guess one.

## Columns

Left to right, no row index:

| Time | Tweet | Category | Source |
| --- | --- | --- | --- |
| `HH:MM` if today (Israel), else `MM/DD` | One-line summary only. No tickers/themes here. | Ticker **or** theme. Company → US style `:NVDA US` (TSMC → `:TSM US`, Cloudflare → `:NET US`). Else one chip: `:AI` `:ROBOTICS` `:SPACE` `:CYBER` `:CHIPS` `:MACRO` | X display name (`SemiAnalysis`), not a source-code column |

Yellow text = top items. Hover/click a row for full original text, clickable `x.com` permalink, and every embedded chart from that tweet (SVGs in `static/charts/`). No photos of people.

Keyboard (click the grid first): `J` / `K` or arrows move; `Enter` opens the permalink.

## Filters (always on, combinable)

Keyword · handle/source · ticker (aliases: TSMC→TSM, Cloudflare→NET) · seven universe sectors · theme chips · today / 24h / 7d · Has chart/media · Universe only.

## Data

- `data/universe.csv` — close-watch extract from the Glilot `Companies_Universe.xlsx` tabs: Vertical SW, Horizontal SW, Pure Cyber, Cyber Related, SI, Semis & HW, Emerging Tech. Software names keep the P1–P5 / composite scores; semis keep the moat-test score. Aliases included.
- `data/tweets.json` — 42 triaged seed items (AI / cyber / physical AI / semis / deep tech / material universe news). Offsets are relative to now so Today/24h/7d stay populated.
- `static/charts/*.svg` — Bloomberg-style seed charts (HBM, CoWoS, rack kW, optics, High-NA, cyber ARR, capex, robots, launches). Not photographs.

Previous Vite portal in Origin could not be read from this environment; universe was rebuilt from the Drive spreadsheet, seed tweets reconstructed.

## Layout

```
app.py                  Streamlit entry (Cloud looks here)
requirements.txt
.streamlit/config.toml  dark / amber, minimal chrome
data/universe.csv
data/tweets.json
static/bloomberg.css
static/charts/*.svg
```
