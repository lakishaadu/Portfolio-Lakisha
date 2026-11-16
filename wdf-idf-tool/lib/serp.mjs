// Holt die Google-Ergebnisse (google.de, Deutsch) über die DataForSEO SERP API
// und sortiert Seiten aus, die für einen Textvergleich nicht taugen.
import { dfsLive } from "./dfs.mjs";
export { dfsConfigured } from "./dfs.mjs";

// Domains, die keine vergleichbaren Ratgeber-/Blogtexte liefern
const BLOCKED = [
  // Marktplätze & Shops
  ["amazon.", "Marktplatz"], ["ebay.", "Marktplatz"], ["otto.de", "Shop"], ["idealo.", "Preisvergleich"], ["check24.", "Preisvergleich"],
  ["geizhals.", "Preisvergleich"], ["billiger.de", "Preisvergleich"], ["zalando.", "Shop"], ["aboutyou.", "Shop"], ["kaufland.", "Marktplatz"],
  ["etsy.", "Marktplatz"], ["aliexpress.", "Marktplatz"], ["temu.", "Marktplatz"], ["shein.", "Shop"], ["mediamarkt.", "Shop"],
  ["saturn.de", "Shop"], ["ikea.", "Shop"], ["obi.de", "Shop"], ["hornbach.", "Shop"], ["bauhaus.", "Shop"], ["douglas.", "Shop"],
  ["dm.de", "Shop"], ["rossmann.", "Shop"], ["lidl.", "Shop"], ["aldi", "Shop"], ["thalia.", "Shop"], ["booking.com", "Buchungsportal"],
  ["kleinanzeigen.", "Kleinanzeigen"], ["shop-apotheke.", "Shop"], ["docmorris.", "Shop"], ["galaxus.", "Shop"], ["conrad.", "Shop"],
  // Video, Social, Foren, Q&A
  ["youtube.", "Video"], ["youtu.be", "Video"], ["vimeo.", "Video"], ["tiktok.", "Social Media"], ["instagram.", "Social Media"],
  ["facebook.", "Social Media"], ["pinterest.", "Social Media"], ["linkedin.", "Social Media"], ["twitter.", "Social Media"], ["x.com", "Social Media"],
  ["reddit.", "Forum"], ["gutefrage.net", "Forum"], ["quora.", "Forum"], ["spotify.", "Podcast/Musik"], ["podcasts.apple.", "Podcast"],
  ["apps.apple.", "App Store"], ["play.google.", "App Store"],
  // Verzeichnisse & Jobbörsen
  ["indeed.", "Jobbörse"], ["stepstone.", "Jobbörse"], ["xing.", "Netzwerk"], ["yelp.", "Verzeichnis"],
  ["trustpilot.", "Bewertungsportal"], ["google.", "Google-Dienst"],
];

export const isGoogleHost = (u) => {
  try {
    return /(^|\.)google\.[a-z.]+$/i.test(new URL(u).hostname);
  } catch {
    return false;
  }
};

/** Holt die echte Zieladresse aus Google-Weiterleitungslinks (z. B. google.com/url?q=…, google.com/amp/s/…). */
export function unwrapGoogleUrl(raw, domain) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return raw;
  }
  if (!isGoogleHost(raw)) return raw;
  for (const key of ["url", "q", "u", "adurl", "imgrefurl"]) {
    const v = u.searchParams.get(key);
    if (v && /^https?:\/\//i.test(v) && !isGoogleHost(v)) return v;
  }
  const amp = u.pathname.match(/^\/amp\/(s\/)?(.+)$/);
  if (amp) return (amp[1] ? "https://" : "http://") + amp[2] + u.search;
  // Ziel steckt manchmal kodiert im Pfad
  const enc = decodeURIComponent(u.pathname + u.search).match(/https?:\/\/[^\s&#]+/);
  if (enc && !isGoogleHost(enc[0])) return enc[0];
  return raw;
}

export async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i]);
    }
  }));
  return out;
}

/** Folgt Google-Weiterleitungen (max. 4 Sprünge), bis eine Nicht-Google-Adresse erreicht ist. */
export async function resolveRedirect(url) {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36" },
      });
      const loc = res.headers.get("location");
      res.body?.cancel?.().catch(() => {});
      if (!loc) return null;
      current = new URL(loc, current).href;
      const viaParam = unwrapGoogleUrl(current);
      if (!isGoogleHost(viaParam)) return viaParam;
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  }
  return null;
}

export function blockReason(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "Ungültige URL";
  }
  if (/\.pdf($|\?)/i.test(url)) return "PDF";
  for (const [needle, reason] of BLOCKED) {
    if (needle.endsWith(".") ? host.startsWith(needle) || host.includes("." + needle) : host === needle || host.endsWith("." + needle) || (!needle.includes(".") && host.split(".")[0] === needle)) return reason;
  }
  return null;
}

/** Echte Domain aus dem Breadcrumb (z. B. „https://www.br.de › nachrichten › …“) – ohne Weiterleitung aufzulösen. */
export function breadcrumbHost(item) {
  const m = String(item?.breadcrumb || "").match(/^(https?:\/\/)?([^\s›/]+)/);
  const host = m ? m[2].toLowerCase().replace(/^www\./, "") : "";
  return /\./.test(host) && !/(^|\.)google\./.test(host) ? host : "";
}

const hostOfUrl = (u) => {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};
const matchesDomain = (host, domains) => !!host && domains.some((d) => host === d || host.endsWith("." + d));

/** Wandelt Google-Weiterleitungen in echte Adressen um (parallel, mit Fallback). */
async function resolveUrl(rawUrl) {
  const direct = unwrapGoogleUrl(rawUrl);
  if (!isGoogleHost(direct)) return direct;
  if (/\/search\b/.test(new URL(direct).pathname)) return direct;
  return (await resolveRedirect(direct)) || direct;
}

/**
 * Google-Ergebnisse (google.de, Deutsch, Desktop) inkl. Nutzerfragen, KI-Übersicht und Featured Snippet.
 * ownDomains: eigene Domains, um die eigene Position zu finden.
 */
export async function fetchSerp(keyword, { depth = 40, ownDomains = [], area = "analyse", resolveAll = true } = {}) {
  const { result, cost } = await dfsLive("/v3/serp/google/organic/live/advanced", { keyword, location_code: 2276, language_code: "de", device: "desktop", depth }, { area });
  const all = result?.items || [];
  const organic = all.filter((i) => i.type === "organic" && i.url);
  console.log(`SERP „${keyword}“: ${organic.length} organische Treffer. Beispiele:`, JSON.stringify(organic.slice(0, 2).map((i) => ({ url: i.url, domain: i.domain, breadcrumb: i.breadcrumb }))));

  // Domain vorab aus Breadcrumb/URL bestimmen, Weiterleitungen nur wo nötig auflösen
  const pre = organic.map((i) => {
    const direct = unwrapGoogleUrl(i.url);
    const host = !isGoogleHost(direct) ? hostOfUrl(direct) : breadcrumbHost(i) || (i.domain && !/google\./.test(i.domain) ? i.domain.replace(/^www\./, "") : "");
    return { i, direct, host };
  });
  const resolved = await mapLimit(pre, 10, async ({ i, direct, host }) => {
    if (!isGoogleHost(direct)) return direct;
    const preBlocked = host && blockReason("https://" + host);
    if (!resolveAll && !matchesDomain(host, ownDomains)) return direct;
    if (preBlocked) return direct; // Amazon & Co. müssen wir nicht auflösen
    return resolveUrl(i.url);
  });

  const results = pre.map(({ i, host }, idx) => {
    let url = resolved[idx];
    const finalHost = isGoogleHost(url) ? host : hostOfUrl(url);
    const unresolved = isGoogleHost(url);
    return {
      rank: i.rank_group,
      url,
      domain: finalHost || i.domain,
      title: i.title || "",
      blocked: host && blockReason("https://" + host) ? blockReason("https://" + host) : unresolved ? (host ? null : "Google-Weiterleitung (Ziel nicht lesbar)") : blockReason(url),
      unresolved: unresolved && !!host,
    };
  });

  // Eigene Position
  const own = results.find((r) => matchesDomain(r.domain, ownDomains));
  // Nutzer fragen auch
  const paa = [];
  for (const it of all.filter((x) => x.type === "people_also_ask")) for (const q of it.items || []) if (q.title) paa.push(q.title);
  // KI-Übersicht (Google AI Overview)
  const aio = all.find((x) => x.type === "ai_overview");
  let aiOverview = null;
  if (aio) {
    const refs = [];
    const collect = (arr) => (arr || []).forEach((r) => r?.url && refs.push({ domain: (r.domain || hostOfUrl(r.url)).replace(/^www\./, ""), url: r.url, title: r.title || r.source || "" }));
    collect(aio.references);
    (aio.items || []).forEach((el) => collect(el.references));
    const unique = [...new Map(refs.map((r) => [r.url, r])).values()];
    aiOverview = { present: true, references: unique.slice(0, 15), ownCited: unique.some((r) => matchesDomain(r.domain, ownDomains)) };
  }
  const fs = all.find((x) => x.type === "featured_snippet");
  const featured = fs ? { domain: (fs.domain || "").replace(/^www\./, ""), url: fs.url, title: fs.title || "" } : null;

  return {
    keyword,
    cost,
    results,
    insights: {
      ownPosition: own ? { rank: own.rank, url: own.url, domain: own.domain } : null,
      peopleAlsoAsk: [...new Set(paa)].slice(0, 12),
      aiOverview: aiOverview || { present: false, references: [], ownCited: false },
      featuredSnippet: featured,
      checkedDepth: depth,
      itemTypes: [...new Set(all.map((x) => x.type))],
    },
  };
}
