// Keyword-Ideen, Content-Lücken, Keywords einer Domain, Backlinks und KI-Sichtbarkeit (DataForSEO).
import { dfsLive, DfsError } from "./dfs.mjs";
import { cleanDomain } from "./settings.mjs";

const DE = { location_code: 2276, language_code: "de" };
const num = (v) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const requireDomain = (d, label = "Domain") => {
  const c = cleanDomain(d);
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(c)) throw new DfsError(`Bitte eine gültige ${label} angeben (z. B. kofferfreundin.de).`, 400);
  return c;
};

/* ---------- Keyword-Ideen ---------- */
export async function keywordIdeas(keyword, { limit = 100 } = {}) {
  const kw = String(keyword || "").trim().toLowerCase();
  if (!kw) throw new DfsError("Bitte ein Keyword angeben.", 400);
  const { result, cost } = await dfsLive(
    "/v3/dataforseo_labs/google/keyword_ideas/live",
    { keywords: [kw], ...DE, limit, filters: [["keyword_info.search_volume", ">", 0]] },
    { area: "keyword-ideen" }
  );
  const items = (result?.items || []).map((it) => ({
    keyword: it.keyword,
    searchVolume: num(it.keyword_info?.search_volume),
    difficulty: num(it.keyword_properties?.keyword_difficulty),
    cpc: num(it.keyword_info?.cpc),
    competition: it.keyword_info?.competition_level || null,
    intent: it.search_intent_info?.main_intent || null,
  }));
  return { keyword: kw, cost, items };
}

/* ---------- Content-Lücken: Konkurrenz rankt, du nicht ---------- */
export async function contentGap(ownDomain, competitorDomain, { limit = 100 } = {}) {
  const own = requireDomain(ownDomain, "eigene Domain");
  const comp = requireDomain(competitorDomain, "Konkurrenz-Domain");
  const { result, cost } = await dfsLive(
    "/v3/dataforseo_labs/google/domain_intersection/live",
    { target1: comp, target2: own, ...DE, intersections: false, item_types: ["organic"], limit, order_by: ["keyword_data.keyword_info.search_volume,desc"] },
    { area: "content-luecken" }
  );
  const items = (result?.items || []).map((it) => {
    const el = it.first_domain_serp_element || {};
    return {
      keyword: it.keyword_data?.keyword,
      searchVolume: num(it.keyword_data?.keyword_info?.search_volume),
      difficulty: num(it.keyword_data?.keyword_properties?.keyword_difficulty),
      competitorRank: num(el.rank_group ?? el.organic?.rank_group),
      competitorUrl: el.url || el.organic?.url || null,
    };
  });
  return { own, competitor: comp, cost, items };
}

/* ---------- Für welche Keywords rankt eine Domain? ---------- */
export async function rankedKeywords(domain, { limit = 100 } = {}) {
  const target = requireDomain(domain);
  const { result, cost } = await dfsLive(
    "/v3/dataforseo_labs/google/ranked_keywords/live",
    { target, ...DE, limit, item_types: ["organic"], order_by: ["keyword_data.keyword_info.search_volume,desc"] },
    { area: "rankings" }
  );
  const items = (result?.items || []).map((it) => {
    const si = it.ranked_serp_element?.serp_item || {};
    return {
      keyword: it.keyword_data?.keyword || it.keyword,
      searchVolume: num(it.keyword_data?.keyword_info?.search_volume),
      difficulty: num(it.keyword_data?.keyword_properties?.keyword_difficulty),
      rank: num(si.rank_group),
      url: si.url || (si.relative_url ? `https://${target}${si.relative_url}` : null),
      etv: num(si.etv),
    };
  });
  return { domain: target, cost, total: num(result?.total_count), items };
}

/* ---------- Backlinks ---------- */
export async function backlinkOverview(domain) {
  const target = requireDomain(domain);
  const [sum, top, recent] = await Promise.all([
    dfsLive("/v3/backlinks/summary/live", { target, include_subdomains: true, rank_scale: "one_hundred" }, { area: "backlinks" }),
    dfsLive("/v3/backlinks/referring_domains/live", { target, limit: 25, order_by: ["rank,desc"], rank_scale: "one_hundred" }, { area: "backlinks" }),
    dfsLive("/v3/backlinks/referring_domains/live", { target, limit: 15, order_by: ["first_seen,desc"], rank_scale: "one_hundred" }, { area: "backlinks" }),
  ]);
  const s = sum.result || {};
  const mapRd = (it) => ({ domain: it.domain, rank: num(it.rank), backlinks: num(it.backlinks), firstSeen: it.first_seen || null, lostDate: it.lost_date || null, spamScore: num(it.backlinks_spam_score) });
  return {
    domain: target,
    cost: (sum.cost || 0) + (top.cost || 0) + (recent.cost || 0),
    summary: {
      rank: num(s.rank),
      backlinks: num(s.backlinks),
      referringDomains: num(s.referring_domains),
      referringMainDomains: num(s.referring_main_domains),
      nofollowDomains: num(s.referring_domains_nofollow),
      brokenBacklinks: num(s.broken_backlinks),
      spamScore: num(s.backlinks_spam_score),
    },
    topDomains: (top.result?.items || []).map(mapRd),
    newestDomains: (recent.result?.items || []).map(mapRd),
  };
}

/** Link-Lücken: Domains, die auf die Konkurrenz verlinken, aber nicht auf dich. */
export async function linkGap(ownDomain, competitorDomains) {
  const own = requireDomain(ownDomain, "eigene Domain");
  const comps = [...new Set((competitorDomains || []).map(cleanDomain).filter(Boolean))].slice(0, 5).map((d) => requireDomain(d, "Konkurrenz-Domain"));
  if (!comps.length) throw new DfsError("Bitte mindestens eine Konkurrenz-Domain angeben.", 400);
  const targets = Object.fromEntries(comps.map((d, i) => [String(i + 1), d]));
  const { result, cost } = await dfsLive(
    "/v3/backlinks/domain_intersection/live",
    { targets, exclude_targets: [own], limit: 100, order_by: ["1.rank,desc"] },
    { area: "backlinks" }
  );
  const items = (result?.items || []).map((it) => {
    const di = it.domain_intersection || {};
    const first = Object.values(di)[0] || {};
    return {
      domain: first.target || null,
      rank: num(first.rank),
      linksTo: Object.entries(di).map(([k, v]) => ({ competitor: targets[k], backlinks: num(v?.backlinks) })),
      intersections: num(it.summary?.intersections_count),
    };
  });
  return { own, competitors: comps, cost, items };
}

/* ---------- KI-Sichtbarkeit (LLM Mentions) ---------- */
export async function aiMentions({ domain, keyword, platform = "google" }) {
  const target = [];
  if (domain) target.push({ domain: requireDomain(domain), search_filter: "include" });
  if (keyword) target.push({ keyword: String(keyword).trim().toLowerCase(), search_scope: ["any"] });
  if (!target.length) throw new DfsError("Bitte eine Domain oder ein Keyword angeben.", 400);
  const loc = platform === "chat_gpt" ? { location_code: 2840, language_code: "en" } : DE;
  const { result, cost } = await dfsLive(
    "/v3/ai_optimization/llm_mentions/search_mentions/live",
    { target, platform, ...loc, limit: 20, order_by: ["ai_search_volume,desc"] },
    { area: "ki-sichtbarkeit", minLeftUsd: 0.15 }
  );
  const d = domain ? cleanDomain(domain) : null;
  const items = (result?.items || []).map((it) => ({
    platform: it.platform,
    question: it.question,
    answer: String(it.answer || "").slice(0, 600),
    aiSearchVolume: num(it.ai_search_volume),
    sources: (it.sources || []).slice(0, 8).map((s) => ({ domain: s.domain, url: s.url, title: s.title })),
    ownCited: d ? (it.sources || []).some((s) => String(s.domain || "").replace(/^www\./, "").endsWith(d)) : null,
  }));
  return { domain: d, keyword: keyword || null, platform, cost, total: num(result?.total_count), items };
}

/* ---------- Suchvolumen-Verlauf eines Keywords (für jede Analyse) ---------- */
export async function keywordOverview(keyword, { area = "analyse" } = {}) {
  const kw = String(keyword || "").trim().toLowerCase();
  const { result, cost } = await dfsLive("/v3/dataforseo_labs/google/keyword_overview/live", { keywords: [kw], ...DE }, { area });
  const it = result?.items?.[0];
  if (!it) return { cost, trend: null };
  return {
    cost,
    trend: {
      searchVolume: num(it.keyword_info?.search_volume),
      monthly: (it.keyword_info?.monthly_searches || []).map((m) => ({ year: m.year, month: m.month, search_volume: num(m.search_volume) })),
      yearlyChange: num(it.keyword_info?.search_volume_trend?.yearly),
      difficulty: num(it.keyword_properties?.keyword_difficulty),
      intent: it.search_intent_info?.main_intent || null,
    },
  };
}

/* ---------- Google Trends (5 Jahre + aufsteigende Suchanfragen) ---------- */
export async function googleTrends(keyword) {
  const kw = String(keyword || "").trim().toLowerCase();
  if (!kw) throw new DfsError("Bitte ein Keyword angeben.", 400);
  const { result, cost } = await dfsLive(
    "/v3/keywords_data/google_trends/explore/live",
    { keywords: [kw], ...DE, time_range: "past_5_years", item_types: ["google_trends_graph", "google_trends_queries_list"] },
    { area: "trends" }
  );
  const items = result?.items || [];
  const graph = items.find((i) => i.type === "google_trends_graph");
  const queries = items.find((i) => i.type === "google_trends_queries_list");
  const points = (graph?.data || [])
    .filter((d) => !d.missing_data)
    .map((d) => ({ date: d.date_from, value: num(Array.isArray(d.values) ? d.values[0] : d.values) }))
    .filter((d) => d.value != null);
  // Jahresvergleich: letzte 12 Monate vs. die 12 Monate davor
  const byYear = (from, to) => {
    const sel = points.slice(from, to);
    return sel.length ? sel.reduce((a, d) => a + d.value, 0) / sel.length : null;
  };
  const perYear = Math.max(1, Math.round(points.length / 5));
  const last = byYear(-perYear), prev = byYear(-2 * perYear, -perYear);
  return {
    keyword: kw,
    cost,
    points,
    changeVsPreviousYear: last != null && prev ? Math.round(((last - prev) / prev) * 100) : null,
    rising: (queries?.data?.rising || []).slice(0, 10).map((q) => ({ query: q.query, value: q.value })),
    top: (queries?.data?.top || []).slice(0, 10).map((q) => ({ query: q.query, value: q.value })),
  };
}
