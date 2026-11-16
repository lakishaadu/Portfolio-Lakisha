// Zentrale API für die Web-Oberfläche und für Bots.  Alle Routen unter /api/*
import { whoIs, checkPassword, sessionCookie, clearCookie } from "../../lib/auth.mjs";
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
    terms: termTable(ev.rows, ev.comps.length),
    competitors: project.competitors.map((c) => ({ rank: c.rank, url: c.url, title: c.title, status: c.status, reason: c.reason || undefined, words: c.words })),
    costUsd: project.cost,
    history: project.history || [],
  };
}

async function analyze(req, who, compact) {
  const input = await readJson(req);
  const project = await runPipeline(input);
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
  const own = (await ownFromInput(input)) || (existing.own?.kind === "url" ? { kind: "url", ...(await loadArticle(existing.own.url)) } : null);
  if (!own) throw new UserError("Bitte „text“ oder „url“ mitschicken.");
  const project = { ...existing, own };
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
  const path = url.pathname.replace(/\/+$/, "");
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

    // Projekte
    if ((path === "/api/projects" || path === "/api/v1/projects") && method === "GET") return json(await listProjects());
    let m = path.match(/^\/api\/(v1\/)?projects\/([\w-]+)$/);
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
        const allowed = { own: body.own, competitors: body.competitors, history: body.history, keyword: body.keyword };
        Object.keys(allowed).forEach((k) => allowed[k] === undefined && delete allowed[k]);
        return json(await saveProject(forStorage({ ...existing, ...allowed, id })));
      }
      if (method === "DELETE") return json({ ok: await deleteProject(id) });
    }
    m = path.match(/^\/api\/(v1\/)?projects\/([\w-]+)\/recheck$/);
    if (m && method === "POST") return await recheck(req, m[2], !!m[1]);

    return json({ error: "Unbekannte Adresse." }, 404);
  } catch (err) {
    if (err instanceof UserError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: `Interner Fehler: ${err.message}` }, 500);
  }
};

export const config = { path: "/api/*" };
