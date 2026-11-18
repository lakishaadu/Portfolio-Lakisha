// Kompletter Analyse-Ablauf auf dem Server: eigener Text -> Google-Top-Ergebnisse -> Seiten laden & filtern.
import { fetchPage } from "./fetch-page.mjs";
import { fetchSerp, blockReason } from "./serp.mjs";
import { getSettings } from "./settings.mjs";
import { keywordOverview } from "./research.mjs";
import { extract, suggestKeywords, detectH2 } from "./extract.mjs";
import { analyzeText } from "../public/analysis.js";

const MIN_WORDS = 300;
const CONCURRENCY = 8;
const hostOf = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};
export const normUrl = (s) => (/^https?:\/\//i.test(s) ? s : "https://" + s);

export class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Lädt eine Seite und liefert den extrahierten Artikel – oder wirft einen verständlichen Fehler. */
export async function loadArticle(url) {
  const { status, body } = await fetchPage(normUrl(url));
  if (status !== 200) throw new UserError(body.error || "Seite konnte nicht geladen werden.", 422);
  return { url: normUrl(url), ...extract(body.html) };
}

export async function ownFromInput({ text, url }) {
  if (text && String(text).trim()) return { kind: "text", text: String(text).trim(), h2: detectH2(text) };
  if (url && String(url).trim()) return { kind: "url", ...(await loadArticle(url)) };
  return null;
}

/**
 * input: { keyword?, url?, text?, competitors? (Anzahl, Standard 20), urls? (manuelle Konkurrenz-Links) }
 * Liefert ein Projekt-Objekt (noch ohne Auswertung).
 */
export async function runPipeline(input, { deadlineMs = 45000 } = {}) {
  const start = Date.now();
  const target = Math.min(20, Math.max(3, Number(input.competitors) || 20));
  const own = await ownFromInput(input);

  let keyword = String(input.keyword || "").trim();
  let autoKeyword = false;
  let suggestions = [];
  if (own?.kind === "url") suggestions = suggestKeywords(own, own.url);
  if (!keyword) {
    if (!suggestions.length) throw new UserError("Bitte ein Keyword angeben (oder einen Link zu deinem Artikel).");
    keyword = suggestions[0];
    autoKeyword = true;
  }

  // Eigene Domains: aus den Einstellungen + Domain des eigenen Artikels
  const settings = await getSettings().catch(() => ({ domains: [] }));
  const ownHost = own?.url ? hostOf(own.url) : "";
  const ownDomains = [...new Set([...(settings.domains || []), ownHost].filter(Boolean))];

  // Konkurrenz: manuell oder Google über DataForSEO
  let candidates, cost = null, insights = null;
  const manual = Array.isArray(input.urls) ? input.urls.filter((u) => /^https?:\/\//i.test(u)).slice(0, 40) : [];
  if (manual.length) {
    candidates = manual.map((url, i) => ({ rank: i + 1, url, domain: hostOf(url), title: "", blocked: blockReason(url) }));
  } else {
    // Google-Ergebnisse und Suchvolumen-Verlauf parallel holen
    const [serp, ov] = await Promise.all([fetchSerp(keyword, { ownDomains }), keywordOverview(keyword).catch((err) => (console.log("Keyword-Overview fehlgeschlagen:", err.message), null))]);
    candidates = serp.results;
    cost = serp.cost + (ov?.cost || 0);
    insights = { ...serp.insights, trend: ov?.trend || null };
  }
  const isOwnDomain = (d) => !!d && ownDomains.some((o) => d === o || d.endsWith("." + o));
  const competitors = candidates.map((c) => {
    const isOwn = isOwnDomain(c.domain || hostOf(c.url));
    return { rank: c.rank, url: c.url, domain: c.domain || hostOf(c.url), title: c.title || "", status: c.blocked || isOwn ? "filtered" : "pending", reason: c.blocked || (isOwn ? "Deine eigene Seite" : "") };
  });

  // Seiten parallel laden, bis genug passende Texte da sind oder die Zeit knapp wird
  const queue = competitors.filter((c) => c.status === "pending");
  let next = 0;
  const usedCount = () => competitors.filter((c) => c.status === "used").length;
  const worker = async () => {
    while (next < queue.length && usedCount() < target && Date.now() - start < deadlineMs) {
      const c = queue[next++];
      c.status = "loading";
      try {
        const { status, body } = await fetchPage(c.url);
        if (status !== 200) throw new Error(body.error);
        const ex = extract(body.html);
        Object.assign(c, { title: ex.title || c.title, h1: ex.h1, h2: ex.h2, text: ex.text, images: ex.images, lists: ex.lists, tables: ex.tables, published: ex.published, modified: ex.modified });
        if (body.finalUrl && !/google\./.test(new URL(body.finalUrl).hostname)) Object.assign(c, { url: body.finalUrl, domain: hostOf(body.finalUrl) });
        const words = analyzeText(ex.text, false).total;
        if (ex.isShop) Object.assign(c, { status: "filtered", reason: "Shop-/Produktseite" });
        else if (words < MIN_WORDS) Object.assign(c, { status: "filtered", reason: `Zu wenig Text (${words} Wörter)` });
        else Object.assign(c, { status: "used", words });
      } catch (err) {
        Object.assign(c, { status: "error", reason: err.message || "Fehler beim Laden" });
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Überzählige (in Google-Reihenfolge) als Reserve, Ungeladene markieren
  let n = 0;
  for (const c of competitors) {
    if (c.status === "used" && ++n > target) Object.assign(c, { status: "reserve", reason: "Reserve (nicht benötigt)" });
    if (c.status === "pending" || c.status === "loading") Object.assign(c, { status: "reserve", reason: "Nicht geladen" });
  }

  return { keyword, autoKeyword, suggestions, own, competitors, cost, insights, targetCompetitors: target, seconds: Math.round((Date.now() - start) / 1000) };
}
