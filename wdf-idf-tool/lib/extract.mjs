// Liest den Artikeltext aus HTML (serverseitig mit linkedom) und erkennt Shop-Seiten.
import { DOMParser } from "linkedom";
import { STOP } from "../public/analysis.js";

const $$ = (sel, el) => [...el.querySelectorAll(sel)];
const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

export function extract(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const ld = $$('script[type="application/ld+json"]', doc).map((s) => s.textContent).join(" ");
  const productSchema = /"@type"\s*:\s*\[?\s*"Product"/i.test(ld) && /"offers"/i.test(ld);
  const title = clean(doc.querySelector("title")?.textContent);
  const desc = clean(doc.querySelector('meta[name="description"]')?.getAttribute("content"));
  const robots = doc.querySelector('meta[name="robots"]')?.getAttribute("content") || "";
  const h1First = clean(doc.querySelector("h1")?.textContent);
  // Veröffentlichungs-/Aktualisierungsdatum (Meta-Tags, JSON-LD, <time>)
  const metaDate = (n) => doc.querySelector(`meta[property="${n}"], meta[name="${n}"], meta[itemprop="${n}"]`)?.getAttribute("content") || "";
  const ldDate = (k) => (ld.match(new RegExp(`"${k}"\\s*:\\s*"([^"]{8,40})"`)) || [])[1] || "";
  const toIso = (v) => {
    const t = Date.parse(v);
    return Number.isFinite(t) && t > Date.parse("2000-01-01") && t < Date.now() + 864e5 ? new Date(t).toISOString().slice(0, 10) : null;
  };
  const published = toIso(metaDate("article:published_time") || ldDate("datePublished") || doc.querySelector("time[datetime]")?.getAttribute("datetime") || "");
  const modified = toIso(metaDate("article:modified_time") || metaDate("og:updated_time") || ldDate("dateModified") || "") || published;
  const body = doc.body || doc.documentElement;
  const cartHits = (body.textContent.match(/in den warenkorb|zum warenkorb|add to cart|in den einkaufswagen/gi) || []).length;

  $$("script,style,noscript,svg,iframe,template,canvas,form,button,select,input", doc).forEach((n) => n.remove());
  $$('nav,header,footer,aside,[role=navigation],[role=banner],[role=contentinfo],[aria-hidden=true],[class*="cookie" i],[id*="cookie" i],[class*="consent" i],[class*="comment" i],[id*="comment" i],[class*="sidebar" i],[class*="related" i],[class*="newsletter" i],[class*="share" i],[class*="breadcrumb" i],[class*="author-box" i]', doc).forEach((n) => n.remove());
  let root = doc.body || doc.documentElement;
  const cands = $$("article, main, [role=main], .entry-content, .post-content, .article-content, .article-body, .content", doc);
  const best = cands.sort((a, b) => b.textContent.length - a.textContent.length)[0];
  if (best && best.textContent.trim().split(/\s+/).length > 150) root = best;

  const h1 = clean(root.querySelector("h1")?.textContent) || h1First;
  const images = $$("img", root).filter((i) => !/logo|icon|avatar|pixel|spacer/i.test((i.getAttribute("src") || "") + (i.getAttribute("class") || ""))).length;
  const lists = $$("ul, ol", root).filter((l) => l.querySelectorAll("li").length >= 2).length;
  const tables = $$("table", root).length;
  const h2 = $$("h2", root).map((n) => clean(n.textContent)).filter(Boolean);
  // Satzgrenzen an Blockelementen, damit keine Wortgruppen über Absätze hinweg entstehen
  $$("p,li,h1,h2,h3,h4,h5,h6,td,th,div,br,dt,dd,blockquote,figcaption", root).forEach((n) => n.append(" . "));
  const text = clean(root.textContent);
  return { title, desc, h1, h2, text, images, lists, tables, published, modified, isShop: (productSchema && cartHits > 0) || cartHits >= 2, noindex: /noindex/i.test(robots) };
}

/** Schlägt anhand von URL, Title, H1 und häufigen Wortgruppen das Haupt-Keyword eines Artikels vor. */
export function suggestKeywords(ex, url) {
  const norm = (s) => String(s || "").toLowerCase().replace(/(\p{L})[-‐–](?=\p{L})/gu, "$1 ");
  const words = (s) => norm(s).match(/[\p{L}\p{N}]+/gu) || [];
  const ok = (w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w);
  const pad = (arr) => ` ${arr.join(" ")} `;
  let slug = "";
  try {
    slug = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() || "").replace(/\.\w+$/, "");
  } catch {}
  const title = pad(words(ex.title)), h1 = pad(words(ex.h1)), slugW = pad(words(slug.replace(/[-_]/g, " ")));
  const counts = new Map();
  for (const sentence of norm(ex.text).split(/[.!?;:|•·\n]+/)) {
    const t = sentence.match(/[\p{L}\p{N}]+/gu) || [];
    for (let i = 0; i < t.length; i++)
      for (let n = 1; n <= 3 && i + n <= t.length; n++) {
        const g = t.slice(i, i + n);
        if (!ok(g[0]) || !ok(g[n - 1])) continue;
        const k = g.join(" ");
        counts.set(k, (counts.get(k) || 0) + 1);
      }
  }
  const scored = [];
  for (const [k, f] of counts) {
    const inT = title.includes(` ${k} `), inH = h1.includes(` ${k} `), inS = slugW.includes(` ${k} `);
    if (f < 2 && !inT && !inH) continue;
    const n = k.split(" ").length;
    scored.push({ k, score: Math.log2(f + 1) * (1 + 2 * inT + 2 * inH + 1.5 * inS) * [0, 1, 2, 2.2][n] });
  }
  scored.sort((a, b) => b.score - a.score);
  let brand = "";
  try {
    brand = new URL(url).hostname.replace(/^www\./, "").split(".")[0].replace(/-/g, " ");
  } catch {}
  const out = [];
  // Die Wortgruppe aus der URL ist meist das Ziel-Keyword
  const slugPhrase = words(slug.replace(/[-_]/g, " ")).filter((w) => !/^\d+$/.test(w));
  while (slugPhrase.length && STOP.has(slugPhrase[0])) slugPhrase.shift();
  while (slugPhrase.length && STOP.has(slugPhrase[slugPhrase.length - 1])) slugPhrase.pop();
  const sp = slugPhrase.join(" ");
  if (slugPhrase.length >= 1 && slugPhrase.length <= 5 && sp !== brand && (title.includes(` ${sp} `) || h1.includes(` ${sp} `) || counts.has(sp))) out.push(sp);
  for (const { k } of scored) {
    if (out.length >= 5) break;
    if (k === brand || out.includes(k)) continue;
    if (!k.includes(" ") && out.some((o) => o.split(" ").includes(k))) continue;
    out.push(k);
  }
  return out;
}

/** Erkennt Zwischenüberschriften in eingefügtem Text (kurze Zeilen ohne Satzzeichen am Ende). */
export function detectH2(text) {
  return String(text || "").split(/\n+/).map((l) => l.trim()).filter((l) => l.length > 3 && l.length < 90 && !/[.,;:!]$/.test(l) && l.split(/\s+/).length <= 12);
}
