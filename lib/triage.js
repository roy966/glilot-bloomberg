import { categoryForTickers, findTickers } from "./universe.js";

const THEMES = ["AI", "ROBOTICS", "SPACE", "CYBER", "CHIPS", "MACRO"];

const THEME_RES = [
  { theme: "ROBOTICS", re: /\b(robotics?|humanoid|physical ai|surgical robot|warehouse robot)\b/i },
  { theme: "SPACE", re: /\b(launch|satellite|rocket|starship|falcon 9|leo constellation|spaceport)\b/i },
  { theme: "CYBER", re: /\b(cyber|ransomware|malware|cve-|zero[- ]day|vulnerability|breach|endpoint)\b/i },
  {
    theme: "CHIPS",
    re: /\b(semiconductor|foundry|wafer|hbm|cowos|gpu|asic|tpu|chiplet|high-na|euv|dram|nand|osat)\b/i,
  },
  { theme: "MACRO", re: /\b(fed\b|fomc|rates? cut|inflation|treasury|cpi\b|powell)\b/i },
  { theme: "AI", re: /\b(ai\b|artificial intelligence|llm|gpt-|inference|foundation model|tokenomics)\b/i },
];

const TOPIC =
  /\b(ai\b|artificial intelligence|llm|cyber|ransomware|malware|cve-|physical ai|robotics?|humanoid|semiconductor|foundry|wafer|hbm|cowos|gpu|asic|deep tech|datacenter|data center|inference|chip(?:s|let)?)\b/i;

const SUPPLY_CHAIN =
  /\b(supplier|customer|foundry|osat|hyperscaler|colocation|backlog|tape-?out|wafer start|design win|socket)\b/i;

const DROP_MEME =
  /\b(lmao|rofl|\bgm\b|nfa\b|not financial advice|to the moon|buy the dip|like if you|rt if you|follow me|giveaway|airdrop|wen\b|gm fam|this you|ratio)\b/i;

const PRICE_SPAM =
  /\b(calls? printing|puts? printing|moon(?:ing)?|easy money|guaranteed returns?|entry now|send it)\b/i;

const ENGAGEMENT = /^(thoughts\??|agree\??|what do you think\??)\s*$/i;

const RUMOR = /\b(i heard|someone told me|rumor mill|unconfirmed chatter|trust me bro)\b/i;

const PRIMARY =
  /\b(primary (?:checks?|source)|we (?:hear|checked)|according to|10-[kq]\b|8-k\b|filing|press release|our (?:data|model|checks?))\b/i;

export function oneLineSummary(text) {
  let t = String(text || "")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\$[A-Z]{1,5}\b/g, " ")
    .replace(/:[A-Z]{1,5}(?:\s+US)?\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "";
  const sentence = t.split(/(?<=[.!?])\s+/)[0] || t;
  if (sentence.length <= 180) return sentence;
  return `${sentence.slice(0, 177).trimEnd()}…`;
}

export function themesFromText(text) {
  const out = [];
  for (const { theme, re } of THEME_RES) {
    if (re.test(text) && !out.includes(theme)) out.push(theme);
  }
  return out;
}

export function concreteNumbers(text) {
  const hits = String(text || "").match(
    /\b\d+(?:[.,]\d+)?\s*(?:%|kW|MW|GW|bn|mn|m\b|b\b|ms|us|nm|mm|kb|mb|gb|tb|tokens?|wafers?|racks?|bps)\b|\$\s?\d+(?:[.,]\d+)?(?:\s*(?:bn|mn|m|b|k))?|\b\d{2,}(?:[.,]\d+)?\b/gi,
  );
  return hits ? [...new Set(hits.map((s) => s.trim()))] : [];
}

function parseTweetDate(s) {
  if (!s) return new Date();
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/**
 * Hector / Glilot Record bar — not “any tweet from the handle list”.
 * `corpus` must already include expanded quote/parent/link text.
 */
export function judgeKeep(corpus, { universe, handleTier = "specialist", mediaCount = 0, handle } = {}) {
  const text = String(corpus || "");
  if (!text.trim()) return { keep: false, reason: "empty" };
  if (DROP_MEME.test(text) || PRICE_SPAM.test(text) || ENGAGEMENT.test(text.trim())) {
    return { keep: false, reason: "spam" };
  }
  if (RUMOR.test(text) && concreteNumbers(text).length < 2) {
    return { keep: false, reason: "unsourced-rumor" };
  }

  const tickers = universe ? findTickers(text, universe) : [];
  const themes = themesFromText(text);
  const numbers = concreteNumbers(text);
  const topic = TOPIC.test(text) || themes.length > 0;
  const chain = SUPPLY_CHAIN.test(text) && tickers.length > 0;
  const materialUniverse = tickers.length > 0;
  const onBeat = topic || materialUniverse || chain;
  if (!onBeat) return { keep: false, reason: "off-topic" };

  const urlCount = (text.match(/https?:\/\//gi) || []).length;
  if (urlCount >= 4 && numbers.length < 2) return { keep: false, reason: "unread-dump" };
  if (text.replace(/https?:\/\/\S+/g, "").trim().length < 40 && numbers.length < 2 && mediaCount === 0) {
    return { keep: false, reason: "thin" };
  }

  const hasChart = mediaCount > 0;
  const primary = PRIMARY.test(text);
  const evidence = numbers.length >= 2 || (numbers.length >= 1 && hasChart) || (numbers.length >= 1 && primary);
  if (!evidence) return { keep: false, reason: "no-evidence" };

  if (handleTier === "wire" && !(materialUniverse && numbers.length >= 2)) {
    return { keep: false, reason: "wire-weak" };
  }
  if (handleTier === "company" && !(onBeat && (numbers.length >= 1 || hasChart))) {
    return { keep: false, reason: "company-weak" };
  }

  return {
    keep: true,
    tickers,
    themes,
    numbers,
    handle,
  };
}

export function toLiveRow(tweet, { corpus, media, universe, handleTier }) {
  const handle = String(tweet.author?.userName || "").replace(/^@/, "");
  const source = String(tweet.author?.name || handle).trim() || handle;
  const text = String(tweet.text || tweet.full_text || "");
  const judged = judgeKeep(corpus || text, {
    universe,
    handleTier,
    mediaCount: (media || []).length,
    handle,
  });
  if (!judged.keep) return { keep: false, reason: judged.reason };

  const tickers = judged.tickers || [];
  let themes = judged.themes || [];
  let category = categoryForTickers(tickers);
  if (!category) {
    const theme = themes[0] || "AI";
    category = `:${theme}`;
    if (!themes.length) themes = [theme];
  }
  const sectors = [];
  if (universe) {
    for (const t of tickers) {
      const rec = universe.byTicker.get(t);
      if (rec?.sector && !sectors.includes(rec.sector)) sectors.push(rec.sector);
    }
  }
  const summary = oneLineSummary(text);
  if (!summary) return { keep: false, reason: "empty-summary" };

  return {
    keep: true,
    item: {
      id: String(tweet.id),
      time: parseTweetDate(tweet.createdAt || tweet.created_at).toISOString(),
      summary,
      full_text: text,
      handle,
      source,
      category,
      permalink: `https://x.com/${handle}/status/${tweet.id}`,
      media: media || [],
      top: Boolean(tickers.length && (judged.numbers || []).length >= 2),
      tickers,
      themes: themes.filter((t) => THEMES.includes(t)),
      sectors,
      in_universe: tickers.length > 0,
      has_media: (media || []).length > 0,
    },
  };
}
