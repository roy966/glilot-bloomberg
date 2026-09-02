import test from "node:test";
import assert from "node:assert/strict";
import { parseRssItems, makeSubstackId } from "../lib/rss.js";
import { judgeSubstackKeep } from "../lib/triage.js";
import { dataFile, loadUniverse } from "../lib/universe.js";
import { imagesFromHtml, verifySubstackPermalink } from "../lib/substack.js";
import { runIngest } from "../lib/ingest.js";

const universe = loadUniverse(dataFile("universe.csv"));

const keepPost =
  "Primary checks: GB300 NVL72 racks quoting 132 kW at the wall, 20% above last year's 110 kW. NVIDIA CoWoS packaging is the constraint, not the GPU die. Semis & HW supply remains tight.";

test("KEEP numbered universe/semis Substack post", () => {
  const r = judgeSubstackKeep(keepPost, { universe });
  assert.equal(r.keep, true);
  assert.ok(r.tickers.includes("NVDA"));
});

test("DROP thin promo how-to and politics with no sector", () => {
  assert.equal(
    judgeSubstackKeep("Subscribe now to read the rest of this post.", { universe }).keep,
    false,
  );
  assert.equal(
    judgeSubstackKeep("How to use ChatGPT: a tutorial for beginners with no data.", { universe }).keep,
    false,
  );
  assert.equal(
    judgeSubstackKeep(
      "The election is 90 days away and both parties are polling at 48 percent with no chip or software angle.",
      { universe },
    ).keep,
    false,
  );
});

test("parse RSS items and slug ids", () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item>
      <title>GB300 power</title>
      <link>https://semianalysis.com/2025/09/16/xais-colossus-2-first-gigawatt-datacenter/</link>
      <guid>https://semianalysis.com/?p=150450148</guid>
      <pubDate>Tue, 16 Sep 2025 17:38:01 +0000</pubDate>
      <content:encoded><![CDATA[<p>132 kW</p><img src="https://substackcdn.com/image/fetch/a.png" />]]></content:encoded>
    </item>
  </channel></rss>`;
  const items = parseRssItems(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "GB300 power");
  assert.match(items[0].link, /colossus-2/);
  const id = makeSubstackId(items[0].link, items[0].guid);
  assert.equal(id, "semianalysis.com:xais-colossus-2-first-gigawatt-datacenter");
});

test("imagesFromHtml skips avatars and seed charts", () => {
  const html = `
    <meta property="og:image" content="https://substackcdn.com/image/fetch/hero.png" />
    <img src="https://substackcdn.com/img/avatars/x.png" />
    <img src="static/charts/gpu-rack-kw.svg" />
    <img src="https://i0.wp.com/semianalysis.com/wp-content/uploads/2025/09/chart.png" />
  `;
  const urls = imagesFromHtml(html, "https://semianalysis.com/p/post");
  assert.ok(urls.some((u) => u.includes("hero.png")));
  assert.ok(urls.some((u) => u.includes("chart.png")));
  assert.ok(!urls.some((u) => /avatar|static\/charts/i.test(u)));
});

test("verify substack permalink slug match / 404", async () => {
  const permalink = "https://semianalysis.com/2025/09/16/xais-colossus-2-first-gigawatt-datacenter/";
  const id = "semianalysis.com:xais-colossus-2-first-gigawatt-datacenter";
  const ok = await verifySubstackPermalink(permalink, id, {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      url: permalink,
      text: async () => `<link rel="canonical" href="${permalink}" />`,
    }),
  });
  assert.equal(ok.ok, true);
  const bad = await verifySubstackPermalink(permalink, id, {
    fetchImpl: async () => ({ ok: false, status: 404, text: async () => "" }),
  });
  assert.equal(bad.ok, false);
});

test("ingest Substack without twitter key merges KEEP rows", async () => {
  const permalink = "https://importai.substack.com/p/nvidia-132kw-and-20-percent";
  const rss = `<?xml version="1.0"?><rss><channel>
    <item>
      <title>GB300 racks at 132 kW, 20% short</title>
      <link>${permalink}</link>
      <guid>${permalink}</guid>
      <pubDate>${new Date().toUTCString()}</pubDate>
      <content:encoded><![CDATA[<p>NVIDIA GB300 NVL72 drawing 132 kW at the rack; CoWoS is 20% short of 2026 demand.</p><img src="https://substackcdn.com/image/fetch/chart.png" />]]></content:encoded>
    </item>
  </channel></rss>`;
  const fetchImpl = async (url) => {
    if (String(url).includes("/feed")) {
      return { ok: true, status: 200, text: async () => rss };
    }
    if (String(url).includes("substackcdn.com")) {
      return { ok: true, status: 200 };
    }
    if (String(url).startsWith("https://importai.substack.com/p/")) {
      return {
        ok: true,
        status: 200,
        url: permalink,
        text: async () =>
          `<link rel="canonical" href="${permalink}" /><img src="https://substackcdn.com/image/fetch/chart.png" />`,
      };
    }
    return { ok: false, status: 404, text: async () => "" };
  };
  const r = await runIngest({
    env: {},
    writeFiles: false,
    fetchImpl,
  });
  assert.equal(r.skipped, "no_key");
  assert.ok(r.substack.kept >= 1);
  assert.equal(r.kept, r.substack.kept);
});
