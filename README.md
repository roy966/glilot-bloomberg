# Glilot Bloomberg

Dense Bloomberg Terminal-style **X / Twitter news** portal for HF Glilot. Black/amber, four columns, combinable filters.

**Production is a static Vite app** on Vercel. There is no serverless ingest and **no Twitter secret** on Vercel, in git, in client JS, or in logs. Do not set `TWITTERAPI_IO_KEY` (or any Twitter credential) as a Vercel env var.

Streamlit is optional and is **not** the Vercel entrypoint (`streamlit_app.py`, not `app.py`).

## Open the feed

```bash
npm install
npm run dev
```

Timezone for “today” / clock is **Asia/Jerusalem**.

```bash
npm run build
npm run preview
npm test
```

Optional Streamlit: `pip install -r streamlit-requirements.txt && streamlit run streamlit_app.py`

## Live vs seed

The browser loads **`/data/live.json`** when that file is present and well-formed. Otherwise it uses seed **`data/tweets.json`**.

`data/live.json` is written by an **off-Vercel** ingest worker, then shipped with the static build (copied into `public/data/` at `npm run build`). Vercel only hosts the built files.

High-signal handles for that worker (not Shauli’s large list) live in `data/handles.json`.

### `live.json` shape

A JSON **array** of rows. Each row:

| field | type | notes |
| --- | --- | --- |
| `id` | string | Tweet id |
| `time` | string | ISO-8601 timestamp |
| `summary` | string | One-line extractive summary. No ticker in this column |
| `full_text` | string | Original tweet text |
| `handle` | string | X username |
| `source` | string | Account display name |
| `category` | string | `:NVDA US` (TSMC → `:TSM US`, Cloudflare → `:NET US`) or one theme `:AI` `:ROBOTICS` `:SPACE` `:CYBER` `:CHIPS` `:MACRO` |
| `permalink` | string | `https://x.com/{userName}/status/{id}` — `{id}` must match `id` |
| `media` | string[] | That tweet’s own HTTPS media URLs only. `[]` if none. Never invented SVGs |
| `top` | boolean | Highlight row |

Optional filter fields: `tickers`, `themes`, `sectors`, `in_universe`, `has_media`.

KEEP: two concrete numbers in text (or chart labels), universe or sector theme, high-signal handle, real permalink whose id matches. DROP memes, price-spam, engagement bait. If the file is missing or any row fails this shape, the site keeps the seed feed.

## Columns

Left to right, no row index:

| Time | Tweet | Category | Source |
| --- | --- | --- | --- |
| `HH:MM` if today (Israel), else `MM/DD` | One-line summary only. No tickers/themes here. | Ticker **or** theme. Company → US style `:NVDA US` (TSMC → `:TSM US`, Cloudflare → `:NET US`). Else one chip: `:AI` `:ROBOTICS` `:SPACE` `:CYBER` `:CHIPS` `:MACRO` | X display name (`SemiAnalysis`) |

Yellow text = top items. Hover/click a row for full original text, clickable `x.com` permalink, and embedded media from that tweet. No photos of people.

Keyboard: `J` / `K` or arrows move; `Enter` opens the permalink.

## Filters (always on, combinable)

Keyword · handle/source · ticker (aliases: TSMC→TSM, Cloudflare→NET) · today / 24h / 7d · FLAGS `HAS CHART/MEDIA` and `UNIVERSE ONLY` · seven universe sectors · theme chips.

## Data

- `data/universe.csv` — close-watch extract from Glilot `Companies_Universe.xlsx`
- `data/tweets.json` — 42 triaged seed items (relative offsets so Today/24h/7d stay populated)
- `data/handles.json` — high-signal X usernames for the off-Vercel worker
- `data/live.json` — optional live feed (not in git until the worker uploads it)
- `static/charts/*.svg` — Bloomberg-style **seed** charts only (copied into `public/` at build)

## Vercel

Root `package.json` + `vercel.json` (`framework: vite`, output `dist`). Static files only. No `/api` ingest route. No Twitter env vars.
