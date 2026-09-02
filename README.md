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

`data/live.json` is written by an **off-Vercel** worker (`scripts/ingest-live.mjs`, GitHub Actions every 10 minutes). It merges **X** rows and **Substack** rows (`kind: "x"` | `kind: "substack"`). Vercel only hosts the built files.

- **X:** `TWITTERAPI_IO_KEY` as a **GitHub Actions repository secret**, never on Vercel. If unset, X ingest is skipped.
- **Substack:** public RSS only (`https://<pub>.substack.com/feed` or `/feed` on a custom domain). No Substack API key. No `eliot_news_search`.

X handles (`data/handles.json`): `SemiAnalysis_`, `dwarkesh_sp`, `sama`, `AnthropicAI`, `OpenAI` only. Never poll a large (~3800) watchlist.

Substack pubs (`data/substacks.json`): SemiAnalysis, Stratechery, Import AI, Latent Space, plus a few cyber/semis/AI feeds. Replace/extend from Shauli’s workbook when available.

### Quality gates

KEEP is Hector / Glilot Record quality:

- KEEP: AI / cyber / physical AI / semis / deep tech; material universe-company or supplier/customer news; numbers, primary sources, and/or charts **from that post**.
- Substack KEEP also requires **two concrete numbers** in the post text (or its own chart labels — do not guess bar heights) **and** a Companies_Universe name or a real sector/sub-sector theme.
- DROP: memes, price-spam, engagement bait, unsourced rumors, off-topic, gazetteer false positives, unread dumps, thin/promo/how-to/politics with no sector hit.
- X: expand quote/parent/links/media or DROP. Permalink `https://x.com/{handle}/status/{id}` verified. Hover media is that tweet’s CDN URLs only.
- Substack: permalink is the post’s canonical **https** URL (substack.com or custom domain); id/slug must match. Hover media is that post’s images (og:image / RSS/html). Never invented SVGs. No media → `[]`.

Live ids never mix with dummy seed charts. If `live.json` is missing or any row fails the shape, the site keeps the seed feed.

### `live.json` shape

A JSON **array** of rows. Each row has `kind`: `x` (default) or `substack`.

Shared fields: `id`, `time` (ISO), `summary` (one-line, no ticker), `full_text`, `handle`, `source` (display name / publication name), `category` (`:NVDA US` or `:AI` / `:CHIPS` / …), `permalink`, `media[]`, `top`.

| kind | `id` | `permalink` | `media` |
| --- | --- | --- | --- |
| `x` | API tweet id (digits) | `https://x.com/{userName}/status/{id}` | Tweet CDN (`pbs.twimg.com` / `video.twimg.com`) |
| `substack` | post slug/guid (not only digits) | canonical https post URL | That post’s images (`substackcdn`, publication CDN, https images from the post). Never `/static/charts` |

## Columns

Left to right, no row index:

| Time | Tweet | Category | Source |
| --- | --- | --- | --- |
| `HH:MM` if today (Israel), else `MM/DD` | One-line summary only. No tickers/themes here. | Ticker **or** theme. | X display name or Substack publication name |

Yellow text = top items. Hover/click a row for full original text, permalink, and that item’s own media.

Keyboard: `J` / `K` or arrows move; `Enter` opens the permalink.

## Filters (always on, combinable)

Keyword · handle/source · ticker (aliases: TSMC→TSM, Cloudflare→NET) · today / 24h / 7d · FLAGS `HAS CHART/MEDIA` and `UNIVERSE ONLY` · seven universe sectors · theme chips.

## Data

- `data/universe.csv` — close-watch extract from Glilot `Companies_Universe.xlsx`
- `data/tweets.json` — 42 triaged seed items (relative offsets so Today/24h/7d stay populated)
- `data/handles.json` — high-signal X usernames
- `data/substacks.json` — high-signal Substack RSS urls
- `data/live.json` — optional mixed live feed (written by ingest)
- `static/charts/*.svg` — Bloomberg-style **seed** charts only (never attached to live ids)

## Vercel

Root `package.json` + `vercel.json` (`framework: vite`, output `dist`). Static files only. No `/api` ingest route. No Twitter env vars.
