import { analyzeText, compute, coverageScore, lengthStats, median } from "./analysis.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n, d = 3) => (Number.isFinite(n) ? n.toFixed(d).replace(".", ",") : "–");
const num = (n) => Number(n).toLocaleString("de-DE");
const TARGET_COMPETITORS = 10;
const MIN_WORDS = 300;

/* ============ Text aus HTML holen + Shop-Erkennung ============ */
function extract(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const ld = $$('script[type="application/ld+json"]', doc).map((s) => s.textContent).join(" ");
  const productSchema = /"@type"\s*:\s*\[?\s*"Product"/i.test(ld) && /"offers"/i.test(ld);
  const title = doc.querySelector("title")?.textContent.trim() || "";
  const desc = doc.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() || "";
  const robots = doc.querySelector('meta[name="robots"]')?.getAttribute("content") || "";
  const fullText = doc.body?.textContent || "";
  const cartHits = (fullText.match(/in den warenkorb|zum warenkorb|add to cart|in den einkaufswagen/gi) || []).length;

  $$("script,style,noscript,svg,iframe,template,canvas,form,button,select,input", doc).forEach((n) => n.remove());
  $$('nav,header,footer,aside,[role=navigation],[role=banner],[role=contentinfo],[aria-hidden=true],[class*="cookie" i],[id*="cookie" i],[class*="consent" i],[class*="comment" i],[id*="comment" i],[class*="sidebar" i],[class*="related" i],[class*="newsletter" i],[class*="share" i],[class*="breadcrumb" i],[class*="author-box" i]', doc).forEach((n) => n.remove());
  let root = doc.body || doc.documentElement;
  const cands = $$("article, main, [role=main], .entry-content, .post-content, .article-content, .article-body, .content", doc);
  const best = cands.sort((a, b) => b.textContent.length - a.textContent.length)[0];
  if (best && best.textContent.trim().split(/\s+/).length > 150) root = best;

  const h1 = (root.querySelector("h1") || doc.querySelector("h1"))?.textContent.replace(/\s+/g, " ").trim() || "";
  const h2 = $$("h2", root).map((n) => n.textContent.replace(/\s+/g, " ").trim()).filter(Boolean);
  // Satzgrenzen an Blockelementen, damit keine Wortgruppen über Absätze hinweg entstehen
  $$("p,li,h1,h2,h3,h4,h5,h6,td,th,div,br,dt,dd,blockquote,figcaption", root).forEach((n) => n.append(" . "));
  const text = root.textContent.replace(/\s+/g, " ").trim();
  return { title, desc, h1, h2, text, isShop: (productSchema && cartHits > 0) || cartHits >= 2, noindex: /noindex/i.test(robots) };
}

/* ============ API ============ */
async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch(path, { headers: { "content-type": "application/json" }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  } catch {
    throw new Error("Das Tool-Fenster (Server) läuft nicht. Starte es über „Start.command“.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
  return data;
}
const loadUrl = (url) => api(`/api/fetch?url=${encodeURIComponent(url)}`).then((d) => d.html);

/* ============ Zustand ============ */
const state = {
  projectId: null,
  keyword: "",
  own: null, // {kind:'text'|'url', url, text, title, desc, h1, h2, counts, total}
  competitors: [], // {rank,url,domain,title,text,h1,h2,status:'used'|'filtered'|'error', reason, manualInclude}
  rows: [],
  history: [],
  cost: null,
};

const setStatus = (msg, isError = false) => {
  const el = $("#status");
  el.textContent = msg;
  el.classList.toggle("error", isError);
};

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

/* ============ Ablauf: Analyse starten ============ */
async function startAnalysis(e) {
  e.preventDefault();
  const keyword = $("#keyword").value.trim();
  if (!keyword) return setStatus("Bitte ein Keyword eingeben.", true);
  const ownMode = $("input[name=ownmode]:checked").value;
  const ownText = $("#own-text").value.trim();
  const ownUrl = $("#own-url").value.trim();
  const manualUrls = [...new Set($("#manual-urls").value.split(/\s+/).filter((s) => /^https?:\/\//i.test(s)))];

  $("#run").disabled = true;
  try {
    state.keyword = keyword;
    state.projectId = state.projectId && state.loadedKeyword === keyword ? state.projectId : null;
    state.history = state.projectId ? state.history : [];

    // 1) Eigener Text
    state.own = null;
    if (ownMode === "text" && ownText) {
      state.own = { kind: "text", text: ownText, h2: detectH2(ownText) };
    } else if (ownMode === "url" && ownUrl) {
      setStatus("Lade deinen Artikel …");
      const ex = extract(await loadUrl(ownUrl));
      state.own = { kind: "url", url: ownUrl, ...ex };
    }
    const ownHost = state.own?.url ? hostOf(state.own.url) : "";

    // 2) Konkurrenz: automatisch über Google oder manuell
    let candidates;
    if (manualUrls.length) {
      candidates = manualUrls.map((url, i) => ({ rank: i + 1, url, domain: hostOf(url), title: "", blocked: null }));
      state.cost = null;
    } else {
      setStatus("Frage Google-Top-Ergebnisse ab (google.de, Deutsch) …");
      const serp = await api("/api/serp", { method: "POST", body: { keyword } });
      candidates = serp.results;
      state.cost = serp.cost;
    }
    state.competitors = candidates.map((c) => ({
      ...c,
      status: c.blocked ? "filtered" : ownHost && c.domain?.replace(/^www\./, "") === ownHost ? "filtered" : "pending",
      reason: c.blocked || (ownHost && c.domain?.replace(/^www\./, "") === ownHost ? "Deine eigene Seite" : ""),
    }));

    // 3) Seiten laden, bis genug passende Texte da sind
    await loadCompetitors();
    finishAndSave(true);
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    $("#run").disabled = false;
  }
}

async function loadCompetitors() {
  const queue = state.competitors.filter((c) => c.status === "pending");
  let usable = state.competitors.filter((c) => c.status === "used").length;
  const batchSize = 6;
  for (let i = 0; i < queue.length && usable < TARGET_COMPETITORS; i += batchSize) {
    const batch = queue.slice(i, i + batchSize);
    setStatus(`Lade Konkurrenz-Seiten … (${usable} von ${TARGET_COMPETITORS} passend)`);
    await Promise.all(
      batch.map(async (c) => {
        try {
          const ex = extract(await loadUrl(c.url));
          Object.assign(c, { title: ex.title || c.title, h1: ex.h1, h2: ex.h2, text: ex.text });
          const words = analyzeText(ex.text, false).total;
          if (ex.isShop) Object.assign(c, { status: "filtered", reason: "Shop-/Produktseite" });
          else if (words < MIN_WORDS) Object.assign(c, { status: "filtered", reason: `Zu wenig Text (${words} Wörter)` });
          else c.status = "used";
        } catch (err) {
          Object.assign(c, { status: "error", reason: err.message });
        }
      })
    );
    usable = state.competitors.filter((c) => c.status === "used").length;
  }
  // Überzählige Treffer (über Top 10 hinaus) als Reserve markieren
  let n = 0;
  for (const c of state.competitors) {
    if (c.status === "used" && ++n > TARGET_COMPETITORS) Object.assign(c, { status: "reserve", reason: "Reserve (nicht benötigt)" });
    if (c.status === "pending") Object.assign(c, { status: "reserve", reason: "Nicht geladen (genug Treffer)" });
  }
}

/** Erkennt Zwischenüberschriften im eingefügten Text (kurze Zeilen ohne Satzzeichen am Ende). */
function detectH2(text) {
  return text.split(/\n+/).map((l) => l.trim()).filter((l) => l.length > 3 && l.length < 90 && !/[.,;:!]$/.test(l) && l.split(/\s+/).length <= 12);
}

/* ============ Berechnen ============ */
function opts() {
  return { bigrams: $("#bigrams").checked, limit: Number($("#limit").value), minCoverage: Number($("#coverage").value), plannedWords: Number($("#planned").value) || 1500 };
}

function recompute() {
  const o = opts();
  const comps = state.competitors.filter((c) => (c.status === "used" || c.manualInclude) && c.text);
  if (comps.length < 2) {
    $("#results").hidden = true;
    renderCompetitors();
    setStatus("Es wurden weniger als 2 passende Konkurrenz-Seiten gefunden. Nimm unten aussortierte Seiten wieder rein oder trag Links manuell ein.", true);
    return false;
  }
  for (const c of comps) Object.assign(c, analyzeText(c.text, o.bigrams));
  if (state.own) Object.assign(state.own, analyzeText(state.own.text, o.bigrams));
  const own = state.own && state.own.total > 0 ? state.own : null;
  state.comps = comps;
  state.len = lengthStats(comps);
  state.rows = compute(own, comps, { ...o, minLength: state.len.low });
  state.h2median = Math.round(median(comps.map((c) => (c.h2 || []).length)));
  state.score = own ? coverageScore(state.rows) : null;
  renderAll();
  return true;
}

async function finishAndSave(isNewRun) {
  if (!recompute()) return;
  setStatus("");
  if (!state.own) return;
  const entry = {
    date: new Date().toISOString(),
    score: state.score,
    words: state.own.total,
    missing: state.rows.filter((r) => r.status.key === "missing").length,
    low: state.rows.filter((r) => r.status.key === "low").length,
    over: state.rows.filter((r) => r.status.key === "over").length,
  };
  const last = state.history[state.history.length - 1];
  if (isNewRun || !last || last.score !== entry.score || last.words !== entry.words) state.history.push(entry);
  try {
    const saved = await api("/api/projects", { method: "POST", body: serializeProject() });
    state.projectId = saved.id;
    state.loadedKeyword = state.keyword;
    $("#recheck").hidden = false;
    $("#saved-hint").textContent = `Gespeichert als Projekt „${state.keyword}“`;
    renderAll();
    loadProjectList();
  } catch (err) {
    $("#saved-hint").textContent = `Konnte nicht speichern: ${err.message}`;
  }
}

function serializeProject() {
  const strip = ({ counts, total, ...rest }) => rest;
  return {
    id: state.projectId || undefined,
    keyword: state.keyword,
    own: state.own ? strip(state.own) : null,
    competitors: state.competitors.map(strip),
    history: state.history,
    cost: state.cost,
  };
}

/* ============ Darstellung ============ */
function renderAll() {
  $("#results").hidden = false;
  renderCompetitors();
  renderReport();
  renderChart(state.rows.slice(0, 20));
  renderTable();
  renderStructure();
}

const STATUS_TXT = {
  missing: (r) => `${r.target}× einbauen`,
  low: (r) => `+${r.status.diff}× ergänzen`,
  over: (r) => `${Math.abs(r.status.diff)}× reduzieren`,
  ok: () => "passt",
  plan: (r) => `ca. ${r.target}× verwenden`,
};

function renderReport() {
  const { rows, own, comps, len, keyword } = state;
  const kw = keyword.toLowerCase();
  const date = new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" });
  const prev = state.history.length > 1 ? state.history[state.history.length - 2] : null;

  const todo = rows.filter((r) => ["missing", "low"].includes(r.status.key));
  const missing = todo.filter((r) => r.status.key === "missing").slice(0, 12);
  const low = todo.filter((r) => r.status.key === "low").slice(0, 8);
  const over = rows.filter((r) => r.status.key === "over").slice(0, 6);

  // Keyword-Checks
  const checks = [];
  if (own) {
    const kwRow = { f: own.counts.get(kw) || 0 };
    const textLower = own.text.toLowerCase();
    const kwInText = kw.includes(" ") ? textLower.split(kw).length - 1 : kwRow.f;
    checks.push([kwInText > 0, `Keyword „${keyword}“ kommt im Text vor`, kwInText ? `${kwInText}×` : "fehlt"]);
    const first = textLower.split(/\s+/).slice(0, 100).join(" ");
    checks.push([first.includes(kw), "Keyword in den ersten 100 Wörtern", first.includes(kw) ? "ja" : "nein"]);
    const lenOk = own.total >= len.low;
    checks.push([lenOk, `Textlänge (Empfehlung ${num(len.low)}–${num(len.high)} Wörter)`, `${num(own.total)} Wörter`]);
    const h2n = (own.h2 || []).length;
    checks.push([h2n >= Math.max(2, state.h2median - 2), `Zwischenüberschriften (Konkurrenz Ø ${state.h2median})`, own.kind === "text" ? `ca. ${h2n} erkannt` : `${h2n} H2`]);
    if (own.kind === "url") {
      checks.push([own.title.toLowerCase().includes(kw), "Keyword im Seitentitel (Title)", own.title ? "" : "kein Title"]);
      checks.push([own.h1.toLowerCase().includes(kw), "Keyword in der Hauptüberschrift (H1)", ""]);
      checks.push([own.desc.toLowerCase().includes(kw), "Keyword in der Meta-Description", own.desc ? "" : "keine Description"]);
    }
  }

  const termList = (list, cls) =>
    list.map((r) => `<li><span class="t">${esc(r.term)}</span><span class="pill ${cls}">${STATUS_TXT[r.status.key](r)}</span></li>`).join("");

  $("#report").innerHTML = `
    <div class="rep-head">
      <div>
        <div class="rep-kicker">WDF*IDF-Bericht</div>
        <div class="rep-kw">${esc(keyword)}</div>
        <div class="rep-meta">${date} · Vergleich mit ${comps.length} Seiten aus den Google-Top-Ergebnissen (google.de)</div>
      </div>
      ${
        own
          ? `<div class="rep-score ${state.score >= 80 ? "good" : state.score >= 60 ? "mid" : "bad"}">
               <div class="rep-score-num">${state.score}<small>%</small></div>
               <div class="rep-score-lbl">Term-Abdeckung${prev ? `<br><span>vorher ${prev.score} %</span>` : ""}</div>
             </div>`
          : `<div class="rep-score plan"><div class="rep-score-num">${num(len.median)}</div><div class="rep-score-lbl">Wörter empfohlen<br><span>${num(len.low)}–${num(len.high)}</span></div></div>`
      }
    </div>
    <div class="rep-verdict">${verdict(own)}${own && own.total < len.low ? `<br><span class="small">Dein Text hat ${num(own.total)} Wörter, empfohlen sind mindestens ${num(len.low)}. Die Ziel-Häufigkeiten sind deshalb schon für ${num(len.low)} Wörter berechnet.</span>` : ""}</div>
    <div class="rep-grid">
      ${
        own
          ? `<div class="rep-box"><h3>Fehlt komplett <span class="count">${todo.filter((r) => r.status.key === "missing").length}</span></h3><ul class="terms">${termList(missing, "missing") || "<li class='muted'>Nichts – sehr gut!</li>"}</ul></div>
             <div class="rep-box"><h3>Zu wenig erwähnt <span class="count">${todo.filter((r) => r.status.key === "low").length}</span></h3><ul class="terms">${termList(low, "low") || "<li class='muted'>Nichts – sehr gut!</li>"}</ul>
               ${over.length ? `<h3 style="margin-top:14px">Zu oft (Überoptimierung) <span class="count">${rows.filter((r) => r.status.key === "over").length}</span></h3><ul class="terms">${termList(over, "over")}</ul>` : ""}</div>
             <div class="rep-box"><h3>Checks</h3><ul class="checks">${checks.map(([ok, label, val]) => `<li class="${ok ? "ok" : "no"}"><span class="ic">${ok ? "✓" : "✗"}</span><span>${esc(label)}${val ? ` <em>${esc(val)}</em>` : ""}</span></li>`).join("")}</ul></div>`
          : `<div class="rep-box wide"><h3>Diese Begriffe gehören in deinen Text</h3><ul class="terms cols">${termList(rows.slice(0, 24), "plan")}</ul></div>`
      }
    </div>`;
  $("#report-hist").innerHTML = own && state.history.length > 1 ? historyHtml() : "";
}

function verdict(own) {
  if (!own) return `Noch kein eigener Text: Hier ist deine Schreibvorlage. Plane etwa <strong>${num(state.len.median)} Wörter</strong> und arbeite die Begriffe unten ein.`;
  const s = state.score;
  const n = state.rows.filter((r) => ["missing", "low"].includes(r.status.key)).length;
  if (s >= 85) return `<strong>Stark!</strong> Dein Text deckt die Themen der Konkurrenz sehr gut ab. ${n ? `Mit ${n} kleinen Ergänzungen holst du das letzte Stück raus.` : ""}`;
  if (s >= 65) return `<strong>Gute Basis.</strong> ${n} Begriffe fehlen oder sind zu schwach – damit schließt du die Lücke zur Konkurrenz.`;
  return `<strong>Hier steckt viel Potenzial drin.</strong> ${n} Begriffe fehlen oder sind zu schwach. Fang oben mit „Fehlt komplett“ an – das sind die wichtigsten.`;
}

function historyHtml() {
  return `<h3>Verlauf</h3><table class="hist"><thead><tr><th>Datum</th><th class="num">Abdeckung</th><th class="num">Wörter</th><th class="num">Fehlt</th><th class="num">Zu wenig</th></tr></thead><tbody>${state.history
    .map((h) => `<tr><td>${new Date(h.date).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}</td><td class="num">${h.score} %</td><td class="num">${num(h.words)}</td><td class="num">${h.missing}</td><td class="num">${h.low}</td></tr>`)
    .join("")}</tbody></table>`;
}

function renderCompetitors() {
  const groups = { used: [], filtered: [], error: [], reserve: [] };
  state.competitors.forEach((c, i) => (groups[c.manualInclude ? "used" : c.status] || groups.filtered).push([c, i]));
  const item = ([c, i], kind) => `
    <li class="cmp ${kind}">
      <span class="rank">${c.rank ?? "–"}</span>
      <span class="cmp-main"><span class="cmp-title">${esc(c.title || c.domain || c.url)}</span><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.domain || hostOf(c.url))}</a></span>
      <span class="cmp-info">${kind === "used" ? (c.total ? `${num(c.total)} Wörter` : "") : esc(c.reason || "")}</span>
      ${kind === "used" ? `<button type="button" class="link" data-exclude="${i}">rausnehmen</button>` : c.text ? `<button type="button" class="link" data-include="${i}">trotzdem nutzen</button>` : ""}
    </li>`;
  $("#competitors").innerHTML = `
    <h3>Verglichen (${groups.used.length})</h3><ul>${groups.used.map((x) => item(x, "used")).join("")}</ul>
    ${groups.filtered.length ? `<h3>Automatisch aussortiert (${groups.filtered.length})</h3><ul>${groups.filtered.map((x) => item(x, "filtered")).join("")}</ul>` : ""}
    ${groups.error.length ? `<h3>Nicht ladbar (${groups.error.length})</h3><ul>${groups.error.map((x) => item(x, "error")).join("")}</ul>` : ""}
    ${groups.reserve.length ? `<details><summary>Reserve (${groups.reserve.length})</summary><ul>${groups.reserve.map((x) => item(x, "filtered")).join("")}</ul></details>` : ""}
    ${state.cost != null ? `<p class="muted small">Kosten dieser Google-Abfrage laut DataForSEO: ${fmt(state.cost, 4)} $</p>` : ""}`;
  $$("[data-exclude]").forEach((b) => b.addEventListener("click", () => {
    const c = state.competitors[b.dataset.exclude];
    Object.assign(c, { status: "filtered", reason: "Von dir rausgenommen", manualInclude: false });
    finishAndSave(false);
  }));
  $$("[data-include]").forEach((b) => b.addEventListener("click", () => {
    const c = state.competitors[b.dataset.include];
    Object.assign(c, { status: "used", manualInclude: true });
    finishAndSave(false);
  }));
}

function renderTable() {
  const own = !!state.own;
  const kw = state.keyword.toLowerCase();
  const head = own
    ? `<tr><th>#</th><th>Begriff</th><th class="num">Konkurrenz Ø<br><small>WDF*IDF</small></th><th class="num">Konkurrenz max</th><th class="num">Du</th><th class="num">Genutzt von</th><th class="num">Du erwähnst</th><th class="num">Ziel</th><th>Empfehlung</th></tr>`
    : `<tr><th>#</th><th>Begriff</th><th class="num">Konkurrenz Ø<br><small>WDF*IDF</small></th><th class="num">Konkurrenz max</th><th class="num">Genutzt von</th><th class="num">Ø Erwähnungen</th><th class="num">Ziel bei ${num(opts().plannedWords)} Wörtern</th></tr>`;
  const n = state.comps.length;
  const body = state.rows
    .map((r, i) => {
      const cls = kw && r.term.includes(kw) ? "kw" : "";
      return own
        ? `<tr class="${cls}" data-status="${r.status.key}"><td>${i + 1}</td><td class="term">${esc(r.term)}</td><td class="num">${fmt(r.avg)}</td><td class="num">${fmt(r.max)}</td><td class="num">${fmt(r.own)}</td><td class="num">${r.used}/${n}</td><td class="num">${r.fOwn}</td><td class="num">${r.target}</td><td><span class="pill ${r.status.key}">${STATUS_TXT[r.status.key](r)}</span></td></tr>`
        : `<tr class="${cls}"><td>${i + 1}</td><td class="term">${esc(r.term)}</td><td class="num">${fmt(r.avg)}</td><td class="num">${fmt(r.max)}</td><td class="num">${r.used}/${n}</td><td class="num">${fmt(r.avgCount, 1)}</td><td class="num">${r.target}×</td></tr>`;
    })
    .join("");
  $("#table").innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
  $("#filters").hidden = !own;
  applyFilter();
}

function applyFilter() {
  const f = $(".chip.active")?.dataset.filter || "all";
  $$("#table tbody tr").forEach((tr) => (tr.hidden = !(f === "all" || (f === "todo" ? tr.dataset.status !== "ok" : tr.dataset.status === f))));
}

function renderStructure() {
  $("#structure").innerHTML = state.comps
    .map((c) => `<details><summary><strong>${esc(c.title || c.domain)}</strong> · ${num(c.total)} Wörter · ${(c.h2 || []).length} H2</summary>
      ${c.h1 ? `<p class="muted">H1: ${esc(c.h1)}</p>` : ""}<ul>${(c.h2 || []).map((h) => `<li>${esc(h)}</li>`).join("") || "<li class='muted'>Keine H2 gefunden</li>"}</ul></details>`)
    .join("");
}

/* ============ Diagramm (Dot-Plot) ============ */
function renderChart(rows) {
  const hasOwn = !!state.own;
  const kw = state.keyword.toLowerCase();
  const W = 760, rowH = 26, top = 18, left = 180, right = 24;
  const H = top + rows.length * rowH + 28;
  const maxV = Math.max(...rows.map((r) => Math.max(r.max, r.own)), 0.01);
  const x = (v) => left + (v / maxV) * (W - left - right);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="WDF*IDF der Top-Begriffe">`;
  for (let i = 0; i <= 4; i++) {
    const v = (maxV / 4) * i;
    svg += `<line x1="${x(v)}" x2="${x(v)}" y1="${top - 6}" y2="${H - 24}" class="grid"/><text x="${x(v)}" y="${H - 6}" class="axis" text-anchor="middle">${fmt(v, 2)}</text>`;
  }
  rows.forEach((r, i) => {
    const y = top + i * rowH + rowH / 2;
    const tip = `${r.term}: Konkurrenz Ø ${fmt(r.avg)}, max ${fmt(r.max)}${hasOwn ? `, du ${fmt(r.own)} (${r.fOwn}× erwähnt, Ziel ${r.target}×)` : `, Ziel ${r.target}×`}`;
    svg += `<g class="row" data-tip="${esc(tip)}"><rect x="0" y="${y - rowH / 2}" width="${W}" height="${rowH}" class="hit"/>
      <text x="${left - 10}" y="${y + 4}" text-anchor="end" class="label ${kw && r.term.includes(kw) ? "kwl" : ""}">${esc(r.term.length > 26 ? r.term.slice(0, 25) + "…" : r.term)}</text>
      <line x1="${x(0)}" x2="${x(r.max)}" y1="${y}" y2="${y}" class="range"/>
      <rect x="${x(0)}" y="${y - 5}" width="${Math.max(2, x(r.avg) - x(0))}" height="10" rx="4" class="bar-avg"/>
      <line x1="${x(r.max)}" x2="${x(r.max)}" y1="${y - 6}" y2="${y + 6}" class="tick-max"/>
      ${hasOwn ? `<circle cx="${x(r.own)}" cy="${y}" r="5" class="dot-own"/>` : ""}</g>`;
  });
  $("#chart").innerHTML = svg + "</svg>";
  $("#legend").innerHTML = `<span><i class="lg avg"></i>Konkurrenz Ø</span><span><i class="lg max"></i>Konkurrenz Maximum</span>${hasOwn ? `<span><i class="lg own"></i>Dein Text</span>` : ""}`;
  const tipEl = $("#tip");
  $$("#chart .row").forEach((g) => {
    g.addEventListener("mousemove", (e) => {
      tipEl.textContent = g.dataset.tip;
      tipEl.hidden = false;
      const box = $("#chart-wrap").getBoundingClientRect();
      tipEl.style.left = Math.min(e.clientX - box.left + 12, box.width - 270) + "px";
      tipEl.style.top = e.clientY - box.top + 14 + "px";
    });
    g.addEventListener("mouseleave", () => (tipEl.hidden = true));
  });
}

/* ============ Projekte ============ */
async function loadProjectList() {
  try {
    const list = await api("/api/projects");
    $("#projects").innerHTML = list.length
      ? list.map((p) => {
          const last = p.history[p.history.length - 1];
          return `<li class="${p.id === state.projectId ? "active" : ""}"><button type="button" class="proj" data-open="${p.id}"><strong>${esc(p.keyword)}</strong><span>${new Date(p.updatedAt).toLocaleDateString("de-DE")}${last ? ` · ${last.score} %` : ""}</span></button><button type="button" class="link del" data-del="${p.id}" title="Löschen">×</button></li>`;
        }).join("")
      : `<li class="muted small">Noch keine Projekte. Nach der ersten Analyse wird automatisch gespeichert.</li>`;
    $$("[data-open]").forEach((b) => b.addEventListener("click", () => openProject(b.dataset.open)));
    $$("[data-del]").forEach((b) => b.addEventListener("click", async () => {
      if (!confirm("Projekt wirklich löschen?")) return;
      await api(`/api/projects/${b.dataset.del}`, { method: "DELETE" });
      if (state.projectId === b.dataset.del) state.projectId = null;
      loadProjectList();
    }));
  } catch {
    $("#projects").innerHTML = `<li class="muted small">Projekte nicht verfügbar.</li>`;
  }
}

async function openProject(id) {
  try {
    const p = await api(`/api/projects/${id}`);
    Object.assign(state, { projectId: p.id, loadedKeyword: p.keyword, keyword: p.keyword, own: p.own, competitors: p.competitors || [], history: p.history || [], cost: p.cost ?? null });
    $("#keyword").value = p.keyword;
    $("#manual-urls").value = "";
    if (p.own?.kind === "url") {
      $("#mode-url").checked = true;
      $("#own-url").value = p.own.url;
    } else {
      $("#mode-text").checked = true;
      $("#own-text").value = p.own?.text || "";
    }
    syncOwnMode();
    $("#saved-hint").textContent = `Projekt „${p.keyword}“ geöffnet. Text überarbeiten und „Erneut prüfen“ klicken – kostet nichts.`;
    $("#recheck").hidden = false;
    recompute();
    setStatus("");
    loadProjectList();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (err) {
    setStatus(err.message, true);
  }
}

/** Erneut prüfen: eigener Text neu, Konkurrenz aus dem gespeicherten Projekt (keine API-Kosten). */
async function recheck() {
  const mode = $("input[name=ownmode]:checked").value;
  try {
    if (mode === "text") {
      const text = $("#own-text").value.trim();
      if (!text) return setStatus("Bitte deinen Text einfügen.", true);
      state.own = { kind: "text", text, h2: detectH2(text) };
    } else {
      const url = $("#own-url").value.trim();
      setStatus("Lade deinen Artikel …");
      state.own = { kind: "url", url, ...extract(await loadUrl(url)) };
    }
    await finishAndSave(true);
  } catch (err) {
    setStatus(err.message, true);
  }
}

function newAnalysis() {
  Object.assign(state, { projectId: null, loadedKeyword: null, own: null, competitors: [], rows: [], history: [], cost: null });
  $("#form").reset();
  syncOwnMode();
  $("#results").hidden = true;
  $("#recheck").hidden = true;
  $("#saved-hint").textContent = "";
  setStatus("");
  loadProjectList();
}

/* ============ Einstellungen ============ */
async function loadConfig() {
  try {
    const c = await api("/api/config");
    $("#dfs-login").value = c.dfsLogin;
    $("#dfs-password").placeholder = c.hasPassword ? "•••••••• (gespeichert)" : "API-Passwort";
    $("#cfg-warning").hidden = !!(c.dfsLogin && c.hasPassword);
  } catch {
    $("#cfg-warning").hidden = false;
  }
}

async function saveConfig(e) {
  e.preventDefault();
  await api("/api/config", { method: "POST", body: { dfsLogin: $("#dfs-login").value, dfsPassword: $("#dfs-password").value } });
  $("#dfs-password").value = "";
  $("#settings").close();
  loadConfig();
}

function syncOwnMode() {
  const mode = $("input[name=ownmode]:checked").value;
  $("#own-text-wrap").hidden = mode !== "text";
  $("#own-url-wrap").hidden = mode !== "url";
}

/* ============ Export ============ */
function exportCsv() {
  const own = !!state.own;
  const lines = [["Begriff", "Konkurrenz Ø WDF*IDF", "Konkurrenz max WDF*IDF", ...(own ? ["Du WDF*IDF", "Du erwähnst"] : []), "Genutzt von", "Ziel-Erwähnungen", "Empfehlung"]];
  for (const r of state.rows) lines.push([r.term, fmt(r.avg), fmt(r.max), ...(own ? [fmt(r.own), r.fOwn] : []), `${r.used}/${state.comps.length}`, r.target, STATUS_TXT[r.status.key](r)]);
  const csv = "﻿" + lines.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `wdf-idf-${state.keyword.replace(/[^\p{L}\p{N}]+/gu, "-")}.csv`;
  a.click();
}

/* ============ Start ============ */
$("#form").addEventListener("submit", startAnalysis);
$("#recheck").addEventListener("click", recheck);
$("#new").addEventListener("click", newAnalysis);
$$("input[name=ownmode]").forEach((r) => r.addEventListener("change", syncOwnMode));
["#bigrams", "#limit", "#coverage", "#planned"].forEach((id) => $(id).addEventListener("change", () => state.competitors.length && recompute()));
$("#csv").addEventListener("click", exportCsv);
$("#print").addEventListener("click", () => window.print());
$("#open-settings").addEventListener("click", () => $("#settings").showModal());
$("#cfg-link").addEventListener("click", () => $("#settings").showModal());
$("#close-settings").addEventListener("click", () => $("#settings").close());
$("#settings-form").addEventListener("submit", saveConfig);
$$(".chip").forEach((c) => c.addEventListener("click", () => {
  $$(".chip").forEach((x) => x.classList.toggle("active", x === c));
  applyFilter();
}));
syncOwnMode();
loadConfig();
loadProjectList();
