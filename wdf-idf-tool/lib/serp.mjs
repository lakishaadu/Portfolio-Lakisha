// Holt die Google-Ergebnisse (google.de, Deutsch) über die DataForSEO SERP API
// und sortiert Seiten aus, die für einen Textvergleich nicht taugen.
import { env } from "./env.mjs";

const ENDPOINT = () => env("DFS_ENDPOINT") || "https://api.dataforseo.com/v3/serp/google/organic/live/regular"; // DFS_ENDPOINT nur für Tests

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

const isGoogleHost = (u) => {
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

export const dfsConfigured = () => !!(env("DFS_LOGIN") && env("DFS_PASSWORD"));

export async function fetchSerp(keyword, { depth = 40 } = {}) {
  const login = env("DFS_LOGIN"), password = env("DFS_PASSWORD");
  if (!login || !password) {
    return { status: 400, body: { error: "Keine DataForSEO-Zugangsdaten hinterlegt. Trag DFS_LOGIN und DFS_PASSWORD in Netlify unter „Environment variables“ ein." } };
  }
  const res = await fetch(ENDPOINT(), {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${login}:${password}`).toString("base64"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify([{ keyword, location_code: 2276, language_code: "de", device: "desktop", depth }]),
  });
  let data;
  try {
    data = await res.json();
  } catch {
    return { status: 502, body: { error: `DataForSEO antwortet nicht verständlich (HTTP ${res.status}).` } };
  }
  if (res.status === 401 || data.status_code === 40100) {
    return { status: 401, body: { error: "DataForSEO lehnt die Zugangsdaten ab. Bitte Login (E-Mail) und API-Passwort prüfen." } };
  }
  const task = data.tasks?.[0];
  if (!task || task.status_code !== 20000) {
    const msg = task?.status_message || data.status_message || "Unbekannter Fehler";
    const hint = /balance|fund|payment/i.test(msg) ? " – vermutlich ist dein Guthaben aufgebraucht." : "";
    return { status: 502, body: { error: `DataForSEO: ${msg}${hint}` } };
  }
  const items = (task.result?.[0]?.items || []).filter((i) => i.type === "organic" && i.url);
  // Protokoll für die Fehlersuche (Netlify → Logs → Functions)
  console.log(`SERP „${keyword}“: ${items.length} organische Treffer. Beispiele:`, JSON.stringify(items.slice(0, 3).map((i) => ({ url: i.url, domain: i.domain, breadcrumb: i.breadcrumb }))));
  const results = items.map((i) => {
    const url = unwrapGoogleUrl(i.url, i.domain);
    const unresolved = isGoogleHost(url) && i.domain && !isGoogleHost("https://" + i.domain);
    return {
      rank: i.rank_group,
      url,
      originalUrl: url !== i.url ? i.url : undefined,
      domain: i.domain,
      title: i.title || "",
      blocked: unresolved ? "Google-Weiterleitung (Ziel nicht lesbar)" : blockReason(url),
    };
  });
  return { status: 200, body: { keyword, cost: data.cost ?? task.cost ?? null, results } };
}
