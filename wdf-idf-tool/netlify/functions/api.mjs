// Zentrale API für die Web-Oberfläche und für Bots.  Alle Routen unter /api/*
import { whoIs, checkPassword, sessionCookie, clearCookie, internalToken } from "../../lib/auth.mjs";
import { getStore } from "@netlify/blobs";
import { DfsError } from "../../lib/dfs.mjs";
import { getSettings, saveSettings, getUsage, budgetLeft } from "../../lib/settings.mjs";
import { listTracked, addTracked, removeTracked, MAX_TRACKED } from "../../lib/rankings.mjs";
import { keywordIdeas, contentGap, rankedKeywords, backlinkOverview, linkGap, aiMentions } from "../../lib/research.mjs";
import { runPipeline, loadArticle, ownFromInput, UserError } from "../../lib/pipeline.mjs";
import { suggestKeywords } from "../../lib/extract.mjs";
import { dfsConfigured } from "../../lib/serp.mjs";
import { listProjects, getProject, saveProject, deleteProject } from "../../lib/store.mjs";
import { evaluate, termTable } from "../../public/report.js";
import { env } from "../../lib/env.mjs";

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });

const readJson = async (req) => {
  try {
    return await req.json();
  } catch {
    throw new UserError("Ungültiger JSON-Body.");
  }
};

// Für die Speicherung: abgeleitete Zählungen weglassen
const strip = (o) => {
  if (!o) return o;
  const { counts, forms, total, ...rest } = o;
  return rest;
};
const forStorage = (p) => ({ ...p, own: strip(p.own), competitors: (p.competitors || []).map(strip) });

function historyEntry(ev) {
  return {
    date: new Date().toISOString(),
    score: ev.score,
    words: ev.own?.total ?? null,
    missing: ev.report.missing.length,
    low: ev.report.tooFew.length,
    over: ev.report.tooMany.length,
  };
}

/** Kompakte Antwort für Bots */
function botResponse(project, ev, req) {
  const origin = new URL(req.url).origin;
  return {
    projectId: project.id,
    projectUrl: `${origin}/#projekt=${project.id}`,
    keyword: project.keyword,
    keywordWasDetected: !!project.autoKeyword,
    keywordSuggestions: project.suggestions || [],
    report: ev.report,
    googleInsights: project.insights || null,
    terms: termTable(ev.rows, ev.comps.length),
    competitors: project.competitors.map((c) => ({ rank: c.rank, url: c.url, title: c.title, status: c.status, reason: c.reason || undefined, words: c.words })),
    costUsd: project.cost,
    history: project.history || [],
  };
}


/* ---------- Recherche-Ergebnisse zwischenspeichern (spart Kosten) ---------- */
const researchStore = () => getStore({ name: "research", consistency: "strong" });
const cacheKey = (type, args) => `${type}:${JSON.stringify(args).toLowerCase().replace(/[^a-z0-9äöüß.,:_-]/g, "")}`.slice(0, 500);

async function cached(type, args, force, fn) {
  const key = cacheKey(type, args);
  if (!force) {
    const hit = await researchStore().get(key, { type: "json" });
    if (hit) return { ...hit, fromCache: true };
  }
  const data = await fn();
  const entry = { ...data, type, args, fetchedAt: new Date().toISOString() };
  await researchStore().setJSON(key, entry, { metadata: { type, args: JSON.stringify(args), fetchedAt: entry.fetchedAt } });
  return { ...entry, fromCache: false };
}

async function researchHistory() {
  const store = researchStore();
  const { blobs } = await store.list();
  const metas = await Promise.all(blobs.slice(0, 300).map((b) => store.getMetadata(b.key)));
  return metas
    .map((m) => m?.metadata && { type: m.metadata.type, args: JSON.parse(m.metadata.args || "{}"), fetchedAt: m.metadata.fetchedAt })
    .filter(Boolean)
    .sort((a, b) => String(b.fetchedAt).localeCompare(String(a.fetchedAt)))
    .slice(0, 50);
}

/** KI-Übersichten aus allen gespeicherten Analysen zusammenfassen (kostenlos). */
async function aiOverviewSummary() {
  const list = (await listProjects()).slice(0, 100);
  const projects = await Promise.all(list.map((p) => getProject(p.id)));
  return projects
    .filter((p) => p?.insights)
    .map((p) => ({
      projectId: p.id,
      keyword: p.keyword,
      date: p.updatedAt,
      ownPosition: p.insights.ownPosition?.rank ?? null,
      aiOverview: !!p.insights.aiOverview?.present,
      ownCited: !!p.insights.aiOverview?.ownCited,
      citedDomains: (p.insights.aiOverview?.references || []).map((r) => r.domain).slice(0, 8),
      featuredSnippet: p.insights.featuredSnippet?.domain || null,
    }));
}

async function analyze(req, who, compact) {
  const input = await readJson(req);
  const project = await runPipeline(input);
  if (project.own?.kind === "url") project.publishedUrl = project.own.url;
  const ev = evaluate(project);
  if (!ev.ok) {
    // Trotzdem zurückgeben, damit man sieht, warum
    return json({ error: "Weniger als 2 passende Konkurrenz-Seiten gefunden.", ...(!compact ? { project: forStorage(project) } : { competitors: project.competitors.map((c) => ({ rank: c.rank, url: c.url, status: c.status, reason: c.reason })) }) }, 422);
  }
  project.history = ev.own ? [historyEntry(ev)] : [];
  project.source = who === "bot" ? "bot" : "web";
  const saved = await saveProject(forStorage(project));
  return compact ? json(botResponse(saved, ev, req)) : json({ project: saved });
}

async function recheck(req, id, compact) {
  const existing = await getProject(id);
  if (!existing) return json({ error: "Projekt nicht gefunden." }, 404);
  const input = await readJson(req);
  const publishedUrl = existing.publishedUrl || (existing.own?.kind === "url" ? existing.own.url : null);
  const own = (await ownFromInput(input)) || (publishedUrl ? { kind: "url", ...(await loadArticle(publishedUrl)) } : null);
  if (!own) throw new UserError("Bitte „text“ oder „url“ mitschicken.");
  const project = { ...existing, own, publishedUrl: publishedUrl || undefined };
  const ev = evaluate(project);
  if (!ev.ok) return json({ error: "Im Projekt sind zu wenige Konkurrenz-Seiten." }, 422);
  const last = (existing.history || []).at(-1);
  const entry = historyEntry(ev);
  project.history = [...(existing.history || [])];
  if (!last || last.score !== entry.score || last.words !== entry.words) project.history.push(entry);
  if (last) ev.report.previousScore = last.score;
  const saved = await saveProject(forStorage(project));
  return compact ? json(botResponse(saved, ev, req)) : json({ project: saved });
}

export default async (req, context) => {
  const url = new URL(req.url);
  const rawPath = url.pathname.replace(/\/+$/, "");
  // /api/v1/research/... und /api/v1/rankings... sind Aliase für Bots
  const path = rawPath.replace(/^\/api\/v1\/(research|rankings|settings|usage)/, "/api/$1");
  let m;
  const method = req.method;
  const secure = url.protocol === "https:";

  try {
    // ---- offen ----
    if (path === "/api/login" && method === "POST") {
      const { password } = await readJson(req);
      if (!env("APP_PASSWORD")) return json({ error: "Es ist noch kein Passwort eingerichtet (APP_PASSWORD in Netlify setzen)." }, 503);
      if (!checkPassword(password)) {
        await new Promise((r) => setTimeout(r, 800)); // bremst Rateversuche
        return json({ error: "Falsches Passwort." }, 401);
      }
      return json({ ok: true }, 200, { "set-cookie": sessionCookie(secure) });
    }
    if (path === "/api/logout") return json({ ok: true }, 200, { "set-cookie": clearCookie(secure) });

    // ---- ab hier nur angemeldet ----
    const who = whoIs(req);
    if (!who) return json({ error: "Nicht angemeldet. Browser: Passwort-Login. Bots: Header „Authorization: Bearer <BOT_API_KEY>“." }, 401);

    if (path === "/api/me") return json({ ok: true, who, dfsConfigured: dfsConfigured(), botKeyConfigured: !!env("BOT_API_KEY") });

    // Artikel laden + Keyword-Vorschläge
    if (path === "/api/suggest" || path === "/api/v1/suggest") {
      const target = url.searchParams.get("url");
      if (!target) throw new UserError("Parameter „url“ fehlt.");
      const art = await loadArticle(target);
      return json({ url: art.url, title: art.title, h1: art.h1, words: art.text.split(/\s+/).length, suggestions: suggestKeywords(art, art.url) });
    }
    if (path === "/api/extract") {
      const target = url.searchParams.get("url");
      if (!target) throw new UserError("Parameter „url“ fehlt.");
      return json(await loadArticle(target));
    }

    // Analyse
    if (path === "/api/analyze" && method === "POST") return await analyze(req, who, false);
    if (path === "/api/v1/analyze" && method === "POST") return await analyze(req, who, true);


    // ---- Einstellungen & Kosten ----
    if (path === "/api/settings" && method === "GET") return json({ ...(await getSettings()), usage: await getUsage(), budget: await budgetLeft() });
    if (path === "/api/settings" && method === "PUT") return json(await saveSettings(await readJson(req)));
    if (path === "/api/usage") return json({ month: await getUsage(), budget: await budgetLeft() });

    // ---- Rankings ----
    if (path === "/api/rankings" && method === "GET") return json({ max: MAX_TRACKED, items: await listTracked() });
    if (path === "/api/rankings" && method === "POST") {
      const b = await readJson(req);
      const domain = b.domain || (await getSettings()).domains[0];
      const items = Array.isArray(b.keywords) ? b.keywords : [b.keyword];
      let list;
      for (const k of items.filter(Boolean).slice(0, 50)) list = await addTracked({ keyword: k, domain });
      return json({ items: list || (await listTracked()) });
    }
    m = path.match(/^\/api\/rankings\/([\w-]+)$/);
    if (m && method === "DELETE") return json({ items: await removeTracked(m[1]) });
    if (path === "/api/rankings/check" && method === "POST") {
      const b = await readJson(req).catch(() => ({}));
      const origin = new URL(req.url).origin;
      const r = await fetch(`${origin}/api/internal/rank-check`, { method: "POST", headers: { "x-internal-token": internalToken(), "content-type": "application/json" }, body: JSON.stringify({ ids: b.ids || null }) });
      return json({ started: r.status === 202 || r.ok, message: "Prüfung läuft im Hintergrund (ca. 1–3 Minuten). Danach die Liste neu laden." }, 202);
    }

    // ---- Recherche (kostet DataForSEO-Guthaben; Ergebnisse werden gespeichert) ----
    if (path === "/api/research/history") return json(await researchHistory());
    if (path === "/api/research/ai-overview-summary") return json(await aiOverviewSummary());
    if (path.startsWith("/api/research/") && method === "POST") {
      const b = await readJson(req);
      const force = !!b.refresh;
      const own = b.own || (await getSettings()).domains[0];
      switch (path) {
        case "/api/research/keyword-ideas":
          return json(await cached("keyword-ideas", { keyword: b.keyword }, force, () => keywordIdeas(b.keyword)));
        case "/api/research/content-gap":
          return json(await cached("content-gap", { own, competitor: b.competitor }, force, () => contentGap(own, b.competitor)));
        case "/api/research/ranked-keywords":
          return json(await cached("ranked-keywords", { domain: b.domain || own }, force, () => rankedKeywords(b.domain || own)));
        case "/api/research/backlinks":
          return json(await cached("backlinks", { domain: b.domain || own }, force, () => backlinkOverview(b.domain || own)));
        case "/api/research/link-gap":
          return json(await cached("link-gap", { own, competitors: b.competitors }, force, () => linkGap(own, b.competitors)));
        case "/api/research/ai-mentions":
          return json(await cached("ai-mentions", { domain: b.domain ?? own, keyword: b.keyword || "", platform: b.platform || "google" }, force, () => aiMentions({ domain: b.domain ?? own, keyword: b.keyword, platform: b.platform || "google" })));
      }
    }

    // Projekte
    if ((path === "/api/projects" || path === "/api/v1/projects") && method === "GET") return json(await listProjects());
    m = path.match(/^\/api\/(v1\/)?projects\/([\w-]+)$/);
    if (m) {
      const [, v1, id] = m;
      if (method === "GET") {
        const p = await getProject(id);
        if (!p) return json({ error: "Projekt nicht gefunden." }, 404);
        if (!v1) return json(p);
        const ev = evaluate(p);
        return ev.ok ? json(botResponse(p, ev, req)) : json({ error: "Projekt hat zu wenige Konkurrenz-Seiten." }, 422);
      }
      if (method === "PUT" && !v1) {
        const body = await readJson(req);
        const existing = await getProject(id);
        if (!existing) return json({ error: "Projekt nicht gefunden." }, 404);
        const allowed = { own: body.own, competitors: body.competitors, history: body.history, keyword: body.keyword, publishedUrl: typeof body.publishedUrl === "string" ? body.publishedUrl : undefined };
        Object.keys(allowed).forEach((k) => allowed[k] === undefined && delete allowed[k]);
        return json(await saveProject(forStorage({ ...existing, ...allowed, id })));
      }
      if (method === "DELETE") return json({ ok: await deleteProject(id) });
    }
    m = path.match(/^\/api\/(v1\/)?projects\/([\w-]+)\/recheck$/);
    if (m && method === "POST") return await recheck(req, m[2], !!m[1]);

    return json({ error: "Unbekannte Adresse." }, 404);
  } catch (err) {
    if (err instanceof UserError || err instanceof DfsError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: `Interner Fehler: ${err.message}` }, 500);
  }
};

export const config = { path: "/api/*", excludedPath: ["/api/internal/*"] };
