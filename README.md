# Glilot Bloomberg

Dense Bloomberg Terminal-style **X / Twitter news** portal for HF Glilot. Black/amber, four columns, combinable filters, seed feed. No Twitter API keys.

**Production is the Vite static app** (Vercel). Streamlit is optional and is **not** the Vercel entrypoint (`streamlit_app.py`, not `app.py`).

## Open the feed

```bash
npm install
npm run dev
```

Timezone for “today” / clock is **Asia/Jerusalem**.

```bash
npm run build
npm run preview
```

Optional Streamlit: `pip install -r streamlit-requirements.txt && streamlit run streamlit_app.py`

## Columns

Left to right, no row index:

| Time | Tweet | Category | Source |
| --- | --- | --- | --- |
| `HH:MM` if today (Israel), else `MM/DD` | One-line summary only. No tickers/themes here. | Ticker **or** theme. Company → US style `:NVDA US` (TSMC → `:TSM US`, Cloudflare → `:NET US`). Else one chip: `:AI` `:ROBOTICS` `:SPACE` `:CYBER` `:CHIPS` `:MACRO` | X display name (`SemiAnalysis`) |

Yellow text = top items. Hover/click a row for full original text, clickable `x.com` permalink, and every embedded chart from that tweet (SVGs). No photos of people.

Keyboard: `J` / `K` or arrows move; `Enter` opens the permalink.

## Filters (always on, combinable)

Keyword · handle/source · ticker (aliases: TSMC→TSM, Cloudflare→NET) · today / 24h / 7d · FLAGS `HAS CHART/MEDIA` and `UNIVERSE ONLY` · seven universe sectors · theme chips.

## Data

- `data/universe.csv` — close-watch extract from Glilot `Companies_Universe.xlsx`
- `data/tweets.json` — 42 triaged seed items (relative offsets so Today/24h/7d stay populated)
- `static/charts/*.svg` — Bloomberg-style seed charts (copied into `public/` at build)

## Vercel

Root `package.json` + `vercel.json` (`framework: vite`, output `dist`). There is **no** `app.py` so Vercel will not treat this as a Python serverless app.
