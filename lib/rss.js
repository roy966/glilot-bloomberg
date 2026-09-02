export function decodeEntities(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export function stripHtml(html) {
  return decodeEntities(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function tagInner(block, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i");
  const m = block.match(re);
  return m ? decodeEntities(m[1]).trim() : "";
}

function tagAttr(block, tag, attr) {
  const re = new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']+)["'][^>]*>`, "i");
  const m = block.match(re);
  return m ? decodeEntities(m[1]).trim() : "";
}

function selfClosingAttr(block, tag, attr) {
  const re = new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']+)["'][^>]*\\/?>`, "i");
  const m = block.match(re);
  return m ? decodeEntities(m[1]).trim() : "";
}

export function parseRssItems(xml) {
  const src = String(xml || "");
  const chunks = [...src.matchAll(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi)].map((m) => m[0]);
  const atom = [...src.matchAll(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi)].map((m) => m[0]);
  const blocks = chunks.length ? chunks : atom;
  return blocks.map((block) => {
    const title = tagInner(block, "title");
    let link = tagInner(block, "link");
    if (!link) link = tagAttr(block, "link", "href");
    const guid = tagInner(block, "guid") || tagInner(block, "id");
    const pubDate = tagInner(block, "pubDate") || tagInner(block, "published") || tagInner(block, "updated");
    const description = tagInner(block, "description") || tagInner(block, "summary");
    const encoded =
      tagInner(block, "content:encoded") || tagInner(block, "content") || "";
    const enclosure = selfClosingAttr(block, "enclosure", "url");
    const enclosureType = selfClosingAttr(block, "enclosure", "type");
    return {
      title,
      link: link.trim(),
      guid: guid.trim(),
      pubDate,
      description,
      content: encoded,
      enclosure,
      enclosureType,
    };
  });
}

export function slugFromPermalink(permalink) {
  try {
    const u = new URL(permalink);
    const parts = u.pathname.split("/").filter(Boolean);
    if (!parts.length) return "";
    return decodeURIComponent(parts[parts.length - 1]).replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function makeSubstackId(permalink, guid) {
  const slug = slugFromPermalink(permalink);
  let host = "";
  try {
    host = new URL(permalink).hostname.replace(/^www\./, "");
  } catch {
    host = "";
  }
  if (host && slug) return `${host}:${slug}`;
  if (guid) return String(guid);
  return slug || permalink;
}
