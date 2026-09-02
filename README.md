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

The browser loads **`/data/live.json`** when that file is present and well-formed. Otherwise it uses seed **`data/tweets.json`**. If the ingest key is unset, ingest no-ops and the site stays on seed.

`data/live.json` is written by an **off-Vercel** worker (`scripts/ingest-live.mjs`, GitHub Actions every 10 minutes). Vercel only hosts the built files. Put `TWITTERAPI_IO_KEY` in **GitHub Actions repository secrets**, never on Vercel.

High-signal handles only (`data/handles.json`). Never poll a large (~3800) watchlist.

### Quality gates (every live row)

KEEP is Hector / Glilot Record quality, not “any tweet from the handle list”:

- KEEP: AI / cyber / physical AI / semis / deep tech; material universe-company or supplier/customer news; numbers, primary sources, and/or charts **from that post**.
- DROP: memes, price-spam, engagement bait, unsourced rumors, off-topic, gazetteer false positives, unread/unjudged dumps.
- Quoted/parent tweets, images, and links are expanded before judging. If they cannot be expanded, DROP.
- Permalink must be the real API tweet: `https://x.com/{handle}/status/{id}`. The worker verifies it (oembed / syndication / twitterapi.io tweet-by-id). 404, wrong tweet, or missing id → DROP. The UI opens that exact link.
- Hover media is that tweet’s own API CDN URLs (including quoted-tweet media). No invented SVGs, no seed `static/charts`, no other tweet’s chart. No media → no chart. If a media URL fails to load, it is omitted, not replaced.

Live ids never mix with dummy seed charts. If `live.json` is missing or any row fails the shape, the site keeps the seed feed.

### `live.json` shape

A JSON **array** of rows. Each row:

| field | type | notes |
| --- | --- | --- |
| `id` | string | API tweet id (digits) |
| `time` | string | ISO-8601 timestamp |
| `summary` | string | One-line extractive summary. No ticker in this column |
| `full_text` | string | Original tweet text |
| `handle` | string | X username |
| `source` | string | Account display name |
| `category` | string | `:NVDA US` (TSMC → `:TSM US`, Cloudflare → `:NET US`) or one theme `:AI` `:ROBOTICS` `:SPACE` `:CYBER` `:CHIPS` `:MACRO` |
| `permalink` | string | `https://x.com/{userName}/status/{id}` — `{id}` must match `id` |
| `media` | string[] | That tweet’s own `pbs.twimg.com` / `video.twimg.com` URLs. `[]` if none |
| `top` | boolean | Highlight row |

Optional filter fields: `tickers`, `themes`, `sectors`, `in_universe`, `has_media`.

## Columns

Left to right, no row index:

| Time | Tweet | Category | Source |
| --- | --- | --- | --- |
| `HH:MM` if today (Israel), else `MM/DD` | One-line summary only. No tickers/themes here. | Ticker **or** theme. Company → US style `:NVDA US` (TSMC → `:TSM US`, Cloudflare → `:NET US`). Else one chip: `:AI` `:ROBOTICS` `:SPACE` `:CYBER` `:CHIPS` `:MACRO` | X display name (`SemiAnalysis`) |

Yellow text = top items. Hover/click a row for full original text, clickable `x.com` permalink, and that tweet’s own media. No invented photos of people.

Keyboard: `J` / `K` or arrows move; `Enter` opens the permalink.

## Filters (always on, combinable)

Keyword · handle/source · ticker (aliases: TSMC→TSM, Cloudflare→NET) · today / 24h / 7d · FLAGS `HAS CHART/MEDIA` and `UNIVERSE ONLY` · seven universe sectors · theme chips.

## Data

- `data/universe.csv` — close-watch extract from Glilot `Companies_Universe.xlsx`
- `data/tweets.json` — 42 triaged seed items (relative offsets so Today/24h/7d stay populated)
- `data/handles.json` — high-signal X usernames for the off-Vercel worker
- `data/live.json` — optional live feed (written by ingest when the key is set)
- `static/charts/*.svg` — Bloomberg-style **seed** charts only (never attached to live ids)

## Vercel

Root `package.json` + `vercel.json` (`framework: vite`, output `dist`). Static files only. No `/api` ingest route. No Twitter env vars.
