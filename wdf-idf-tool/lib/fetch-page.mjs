// Holt eine fremde Webseite serverseitig ab (umgeht CORS im Browser).
// Wird von der Netlify-Funktion genutzt.

const MAX_BYTES = 4 * 1024 * 1024; // 4 MB
const TIMEOUT_MS = 10000;

function isBlockedHost(hostname) {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (/^\[?::1\]?$/.test(h) || h.startsWith("[fc") || h.startsWith("[fd") || h.startsWith("[fe80")) return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  return false;
}

export async function fetchPage(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { status: 400, body: { error: "Ungültige URL." } };
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    return { status: 400, body: { error: "Nur http- und https-Links sind erlaubt." } };
  }
  if (isBlockedHost(url.hostname)) {
    return { status: 400, body: { error: "Diese Adresse ist nicht erlaubt." } };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; WDF-IDF-Analyse/1.0)",
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.7",
      },
    });
    const type = res.headers.get("content-type") || "";
    if (!res.ok) {
      return { status: 502, body: { error: `Die Seite antwortet mit Status ${res.status}.` } };
    }
    if (type && !/html|xml|text/i.test(type)) {
      return { status: 415, body: { error: `Kein HTML (Content-Type: ${type}).` } };
    }
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) {
        controller.abort();
        break;
      }
      chunks.push(value);
    }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    let charset = (type.match(/charset=([^;]+)/i) || [])[1];
    if (!charset) {
      const head = buf.subarray(0, 4096).toString("latin1");
      charset = (head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1];
    }
    let html;
    try {
      html = new TextDecoder((charset || "utf-8").trim().toLowerCase()).decode(buf);
    } catch {
      html = new TextDecoder("utf-8").decode(buf);
    }
    return { status: 200, body: { url: rawUrl, finalUrl: res.url, html } };
  } catch (err) {
    const msg = err.name === "AbortError" ? "Zeitüberschreitung beim Laden." : `Laden fehlgeschlagen: ${err.message}`;
    return { status: 502, body: { error: msg } };
  } finally {
    clearTimeout(timer);
  }
}
