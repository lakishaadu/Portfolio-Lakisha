import { evaluate, ACTION_TXT, termTable } from "./report.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n, d = 3) => (Number.isFinite(n) ? n.toFixed(d).replace(".", ",") : "–");
const num = (n) => Number(n).toLocaleString("de-DE");
const looksLikeUrl = (s) => /^https?:\/\/\S+$/i.test(s) || /^www\.[^\s.]+\.\S+$/i.test(s);
const normUrl = (s) => (/^https?:\/\//i.test(s) ? s : "https://" + s);
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

/* ============ API ============ */
async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch(path, { headers: { "content-type": "application/json" }, credentials: "same-origin", ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  } catch {
    throw new Error("Keine Verbindung zum Server. Bitte Internet prüfen.");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/api/login") {
    showLogin();
    throw new Error("Bitte neu anmelden.");
  }
  if (!res.ok) {
    const err = new Error(data.error || `Fehler ${res.status}`);
    err.data = data;
    throw err;
  }
  return data;
}

/* ============ Zustand ============ */
const state = { project: null, ev: null, pendingLink: null };

const setStatus = (msg, isError = false) => {
  const el = $("#status");
  el.textContent = msg;
  el.classList.toggle("error", isError);
};

let timer = null;
function busy(on, label = "Analyse läuft") {
  $("#run").disabled = on;
  $("#kw-go").disabled = on;
  $("#recheck").disabled = on;
  clearInterval(timer);
  if (on) {
    const t0 = Date.now();
    const tick = () => setStatus(`${label} … ${Math.round((Date.now() - t0) / 1000)} s (dauert meist 20–60 Sekunden)`);
    tick();
    timer = setInterval(tick, 1000);
  }
}

function opts() {
  return { bigrams: $("#bigrams").checked, limit: Number($("#limit").value), minCoverage: Number($("#coverage").value), plannedWords: Number($("#planned").value) || 1500 };
}

/* ============ Login ============ */
function showLogin() {
  $("#app").hidden = true;
  $("#login").hidden = false;
  $("#login-pw").focus();
}
async function login(e) {
  e.preventDefault();
  $("#login-status").textContent = "";
  try {
    await api("/api/login", { method: "POST", body: { password: $("#login-pw").value } });
    $("#login-pw").value = "";
    await boot();
  } catch (err) {
    $("#login-status").textContent = err.message;
  }
}
async function logout() {
  await fetch("/api/logout", { method: "POST" }).catch(() => {});
  showLogin();
}

async function boot() {
  try {
    const me = await api("/api/me");
    $("#login").hidden = true;
    $("#app").hidden = false;
    $("#cfg-warning").hidden = me.dfsConfigured;
    syncOwnMode();
    syncInputMode();
    await loadProjectList();
    const m = location.hash.match(/projekt=([\w-]+)/);
    if (m) openProject(m[1]);
  } catch {
    /* showLogin wurde bereits aufgerufen */
  }
}

/* ============ Eingabe: Keyword ODER Link ============ */
function syncInputMode() {
  const isUrl = looksLikeUrl($("#keyword").value.trim());
  $("#own-section").hidden = isUrl;
  $("#link-hint").hidden = !isUrl;
  $("#run").textContent = isUrl ? "Artikel laden" : "Analyse starten";
  if (!isUrl || (state.pendingLink && state.pendingLink.url !== normUrl($("#keyword").value.trim()))) {
    $("#kw-confirm").hidden = true;
    state.pendingLink = null;
  }
}
function syncOwnMode() {
  const mode = $("input[name=ownmode]:checked").value;
  $("#own-text-wrap").hidden = mode !== "text";
  $("#own-url-wrap").hidden = mode !== "url";
}

function showKeywordConfirm() {
  const { suggestions, title, url } = state.pendingLink;
  $("#kw-pick").value = suggestions[0] || "";
  $("#kw-article").textContent = title || url;
  $("#kw-suggestions").innerHTML = suggestions.map((k) => `<button type="button" class="chip" data-kw="${esc(k)}">${esc(k)}</button>`).join("");
  $$("#kw-suggestions [data-kw]").forEach((b) =>
    b.addEventListener("click", () => {
      $("#kw-pick").value = b.dataset.kw;
      $$("#kw-suggestions .chip").forEach((x) => x.classList.toggle("active", x === b));
    })
  );
  $("#kw-suggestions .chip")?.classList.add("active");
  $("#kw-confirm").hidden = false;
  $("#kw-pick").focus();
}

async function startAnalysis(e) {
  e.preventDefault();
  const input = $("#keyword").value.trim();
  if (!input) return setStatus("Bitte ein Keyword oder einen Link eingeben.", true);
  if (!looksLikeUrl(input)) {
    const mode = $("input[name=ownmode]:checked").value;
    const text = mode === "text" ? $("#own-text").value.trim() : "";
    const url = mode === "url" && $("#own-url").value.trim() ? normUrl($("#own-url").value.trim()) : "";
    return runAnalysis({ keyword: input, text: text || undefined, url: url || undefined });
  }
  const url = normUrl(input);
  if (state.pendingLink?.url === url && !$("#kw-confirm").hidden) return confirmKeyword();
  $("#run").disabled = true;
  setStatus("Lade deinen Artikel …");
  try {
    const s = await api(`/api/suggest?url=${encodeURIComponent(url)}`);
    state.pendingLink = { url, title: s.title, suggestions: s.suggestions };
    setStatus("");
    showKeywordConfirm();
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    $("#run").disabled = false;
  }
}

function confirmKeyword() {
  const kw = $("#kw-pick").value.trim();
  if (!kw) return setStatus("Bitte ein Keyword auswählen oder eintippen.", true);
  return runAnalysis({ keyword: kw, url: state.pendingLink.url });
}

async function runAnalysis(input) {
  const urls = [...new Set($("#manual-urls").value.split(/\s+/).filter((s) => /^https?:\/\//i.test(s)))];
  busy(true, `Google-Abfrage und Analyse für „${input.keyword}“`);
  try {
    const { project } = await api("/api/analyze", { method: "POST", body: { ...input, competitors: Number($("#ncomp").value), urls: urls.length ? urls : undefined } });
    busy(false);
    setStatus("");
    $("#kw-confirm").hidden = true;
    loadIntoUi(project);
    loadProjectList();
  } catch (err) {
    busy(false);
    setStatus(err.message, true);
    // Bei zu wenigen Seiten trotzdem zeigen, warum
    if (err.data?.project) {
      state.project = err.data.project;
      state.ev = null;
      $("#results").hidden = false;
      $("#results").classList.add("only-competitors");
      renderCompetitors();
    }
  }
}

/* ============ Projekt laden / auswerten / speichern ============ */
function loadIntoUi(project) {
  state.project = project;
  history.replaceState(null, "", `#projekt=${project.id}`);
  // Link-Projekte: veröffentlichte Adresse merken, auch wenn danach Text geprüft wurde
  if (project.own?.kind === "url" && !project.publishedUrl) project.publishedUrl = project.own.url;
  const linkProject = !!project.publishedUrl;
  $("#keyword").value = linkProject ? project.publishedUrl : project.keyword;
  $("#recheck-text").value = linkProject && project.own?.kind === "text" ? project.own.text : "";
  if (!linkProject && project.own?.kind === "text") {
    $("#mode-text").checked = true;
    $("#own-text").value = project.own.text;
  }
  syncOwnMode();
  syncInputMode();
  $("#kw-confirm").hidden = true;
  $("#recheck-text-wrap").hidden = !linkProject;
  $("#recheck").hidden = !project.own;
  $("#saved-hint").textContent = `Projekt „${project.keyword}“ – gespeichert. ${project.own ? (linkProject ? "Überarbeiteten Text unten einfügen (oder leer lassen für den veröffentlichten Artikel) und „Erneut prüfen“ klicken – kostet nichts." : "Text überarbeiten und „Erneut prüfen“ klicken – kostet nichts.") : ""}`;
  recompute();
}

function recompute() {
  const p = state.project;
  if (!p) return;
  const ev = evaluate(p, opts());
  state.ev = ev.ok ? ev : null;
  $("#results").hidden = false;
  if (!ev.ok) {
    $("#results").classList.add("only-competitors");
    renderCompetitors();
    setStatus("Weniger als 2 passende Konkurrenz-Seiten. Unten siehst du warum – nimm Seiten mit „trotzdem nutzen“ wieder rein.", true);
    return;
  }
  $("#results").classList.remove("only-competitors");
  renderAll();
}

const strip = (o) => { if (!o) return o; const { counts, forms, total, ...rest } = o; return rest; };
async function persist() {
  const p = state.project;
  try {
    const saved = await api(`/api/projects/${p.id}`, { method: "PUT", body: { own: strip(p.own), competitors: p.competitors.map(strip), history: p.history, publishedUrl: p.publishedUrl } });
    state.project.updatedAt = saved.updatedAt;
    loadProjectList();
  } catch (err) {
    setStatus(`Konnte nicht speichern: ${err.message}`, true);
  }
}

async function recheck() {
  const p = state.project;
  if (!p) return;
  busy(true, "Prüfe erneut");
  try {
    if (p.publishedUrl) {
      const pasted = $("#recheck-text").value.trim();
      if (pasted) {
        p.own = { kind: "text", text: pasted, h2: detectH2(pasted), sourceUrl: p.publishedUrl };
      } else {
        const art = await api(`/api/extract?url=${encodeURIComponent(p.publishedUrl)}`);
        p.own = { kind: "url", ...art };
      }
    } else {
      const text = $("#own-text").value.trim();
      if (!text) throw new Error("Bitte deinen Text einfügen.");
      p.own = { kind: "text", text, h2: detectH2(text) };
    }
    busy(false);
    recompute();
    if (!state.ev) return;
    const entry = { date: new Date().toISOString(), score: state.ev.score, words: state.ev.own.total, missing: state.ev.report.missing.length, low: state.ev.report.tooFew.length, over: state.ev.report.tooMany.length };
    const last = (p.history || []).at(-1);
    if (last && last.score === entry.score && last.words === entry.words) {
      setStatus("Keine Änderung zur letzten Prüfung.");
      return;
    }
    p.history = [...(p.history || []), entry];
    recompute();
    setStatus("");
    await persist();
  } catch (err) {
    busy(false);
    setStatus(err.message, true);
  }
}

function detectH2(text) {
  return text.split(/\n+/).map((l) => l.trim()).filter((l) => l.length > 3 && l.length < 90 && !/[.,;:!]$/.test(l) && l.split(/\s+/).length <= 12);
}

/* ============ Darstellung ============ */
function renderAll() {
  renderCompetitors();
  renderReport();
  renderChart(state.ev.rows.filter((r) => !r.generic).slice(0, 20));
  renderTable();
  renderStructure();
}

function renderReport() {
  const { report: r, comps } = state.ev;
  const own = !!state.ev.own && state.ev.own.total > 0;
  const date = new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" });
  const list = (items, cls, max) =>
    items.slice(0, max).map((t) => `<li><span class="t">${esc(t.term)}</span><span class="pill ${cls}">${esc(t.action)}</span></li>`).join("");
  const level = r.coverageScore >= 80 ? "good" : r.coverageScore >= 60 ? "mid" : "bad";

  $("#report").innerHTML = `
    <div class="rep-head">
      <div>
        <div class="rep-kicker">WDF*IDF-Bericht</div>
        <div class="rep-kw">${esc(r.keyword)}</div>
        <div class="rep-meta">${date} · Vergleich mit ${comps.length} Seiten aus den Google-Top-Ergebnissen (google.de)</div>
      </div>
      ${
        own
          ? `<div class="rep-score ${level}"><div class="rep-score-num">${r.coverageScore}<small>%</small></div><div class="rep-score-lbl">Term-Abdeckung${r.previousScore != null ? `<br><span>vorher ${r.previousScore} %</span>` : ""}</div></div>`
          : `<div class="rep-score plan"><div class="rep-score-num">${num(r.length.competitorMedian)}</div><div class="rep-score-lbl">Wörter empfohlen<br><span>${num(r.length.recommendedMin)}–${num(r.length.recommendedMax)}</span></div></div>`
      }
    </div>
    <div class="rep-verdict"><strong>${esc(r.verdict.headline)}</strong> ${esc(r.verdict.text)}${
      own && r.length.yours < r.length.recommendedMin
        ? `<br><span class="small">Dein Text hat ${num(r.length.yours)} Wörter, empfohlen sind mindestens ${num(r.length.recommendedMin)}. Die Ziel-Häufigkeiten sind deshalb schon für ${num(r.length.recommendedMin)} Wörter berechnet.</span>`
        : ""
    }</div>
    <div class="rep-grid">
      ${
        own
          ? `<div class="rep-box"><h3>Fehlt komplett <span class="count">${r.missing.length}</span></h3><ul class="terms">${list(r.missing, "missing", 12) || "<li class='muted'>Nichts – sehr gut!</li>"}</ul></div>
             <div class="rep-box"><h3>Zu wenig erwähnt <span class="count">${r.tooFew.length}</span></h3><ul class="terms">${list(r.tooFew, "low", 8) || "<li class='muted'>Nichts – sehr gut!</li>"}</ul>
               ${r.tooMany.length ? `<h3 style="margin-top:14px">Zu oft (Überoptimierung) <span class="count">${r.tooMany.length}</span></h3><ul class="terms">${list(r.tooMany, "over", 6)}</ul>` : ""}</div>
             <div class="rep-box"><h3>Checks</h3><ul class="checks">${r.checks.map((c) => `<li class="${c.ok ? "ok" : "no"}"><span class="ic">${c.ok ? "✓" : "✗"}</span><span>${esc(c.label)}${c.value ? ` <em>${esc(c.value)}</em>` : ""}</span></li>`).join("")}</ul></div>`
          : `<div class="rep-box wide"><h3>Diese Begriffe gehören in deinen Text</h3><ul class="terms cols">${list(r.writingPlan, "plan", 24)}</ul></div>`
      }
    </div>${insightsHtml(state.project.insights)}${trendHtml(r.trend)}${contentHtml(r.content)}`;

  const h = state.project.history || [];
  $("#report-hist").innerHTML =
    own && h.length > 1
      ? `<h3>Verlauf</h3><table class="hist"><thead><tr><th>Datum</th><th class="num">Abdeckung</th><th class="num">Wörter</th><th class="num">Fehlt</th><th class="num">Zu wenig</th></tr></thead><tbody>${h
          .map((x) => `<tr><td>${new Date(x.date).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}</td><td class="num">${x.score} %</td><td class="num">${num(x.words)}</td><td class="num">${x.missing}</td><td class="num">${x.low}</td></tr>`)
          .join("")}</tbody></table>`
      : "";
}

const INTENT_DE = { informational: "Information", navigational: "Navigation", commercial: "Kaufvorbereitung", transactional: "Kauf" };

function seasonBars(points) {
  const max = Math.max(...points.map((p) => p.value), 1);
  const W = 360, H = 90, bw = W / points.length;
  return `<svg viewBox="0 0 ${W} ${H + 18}" class="season" role="img" aria-label="Suchvolumen der letzten 12 Monate">${points
    .map((p, i) => {
      const h = Math.max(2, (p.value / max) * H);
      return `<g><title>${esc(p.label)}: ${num(p.value)} Suchen</title><rect x="${i * bw + 3}" y="${H - h}" width="${bw - 6}" height="${h}" rx="3"/><text x="${i * bw + bw / 2}" y="${H + 13}" text-anchor="middle">${esc(p.label.slice(0, 3))}</text></g>`;
    })
    .join("")}</svg>`;
}

function trendHtml(t) {
  if (!t) return "";
  const s = t.season;
  return `<div class="insights trend">
    <div><h3>Suchvolumen</h3><p><span class="pos" style="font-size:26px">${t.searchVolume != null ? num(t.searchVolume) : "–"}</span><br><span class="small muted">Suchen pro Monat (Google.de)</span></p>
      ${t.yearlyChange != null ? `<p class="small">${t.yearlyChange >= 0 ? "▲" : "▼"} ${Math.abs(Math.round(t.yearlyChange))} % zum Vorjahr</p>` : ""}
      ${t.difficulty != null ? `<p class="small">Schwierigkeit: <strong>${t.difficulty}</strong>/100${t.difficulty >= 60 ? " – schwer, ggf. ein spezielleres Keyword wählen" : t.difficulty <= 30 ? " – gute Chancen" : ""}</p>` : ""}
      ${t.intent ? `<p class="small">Suchabsicht: ${esc(INTENT_DE[t.intent] || t.intent)}</p>` : ""}</div>
    <div style="grid-column: span 2"><h3>Saison (letzte 12 Monate)</h3>${s ? seasonBars(s.points) + `<p class="small">${esc(s.advice)}</p>` : `<p class="muted small">Für dieses Keyword liefert DataForSEO keinen Verlauf.</p>`}</div>
  </div>`;
}

function contentHtml(c) {
  if (!c || (!c.tips.length && !c.titleIdeas.length)) return "";
  return `<div class="insights content">
    <div style="grid-column: span 2"><h3>Was die Top-Artikel anders machen</h3><ul>${c.tips.map((t) => `<li>${esc(t.text)}</li>`).join("")}</ul></div>
    <div><h3>Title-Ideen</h3><ul>${c.titleIdeas.map((t) => `<li>${esc(t.title)} <span class="muted small">(${t.length} Zeichen${t.length > 60 ? " – zu lang" : ""})</span></li>`).join("")}</ul><p class="small muted">Zum Weiterdenken – in deinem Ton anpassen.</p></div>
  </div>`;
}

function insightsHtml(ins) {
  if (!ins) return "";
  const pos = ins.ownPosition;
  const aio = ins.aiOverview || {};
  return `<div class="insights">
    <div><h3>Deine Google-Position</h3>${
      pos ? `<p><span class="pos" style="font-size:26px">#${pos.rank}</span><br><span class="small muted">${esc(pos.domain || "")}</span></p>` : `<p class="muted small">Nicht in den Top ${ins.checkedDepth || 40} gefunden${state.project.own ? "" : " (oder keine eigene Domain hinterlegt – siehe Einstellungen)"}.</p>`
    }${ins.featuredSnippet ? `<p class="small">Hervorgehobenes Snippet: <strong>${esc(ins.featuredSnippet.domain)}</strong></p>` : ""}</div>
    <div><h3>Nutzer fragen auch</h3>${ins.peopleAlsoAsk?.length ? `<ul>${ins.peopleAlsoAsk.map((q) => `<li>${esc(q)}</li>`).join("")}</ul><p class="small muted">Gut als Zwischenüberschriften oder FAQ.</p>` : `<p class="muted small">Google zeigt hier keine Fragen.</p>`}</div>
    <div><h3>KI-Übersicht</h3>${
      aio.present
        ? `<p class="small">${aio.ownCited ? "✓ <strong>Du wirst zitiert.</strong>" : "✗ Du wirst nicht zitiert."}</p>${aio.references?.length ? `<ul>${aio.references.slice(0, 6).map((r) => `<li>${esc(r.domain)}</li>`).join("")}</ul>` : ""}`
        : `<p class="muted small">Google zeigt für dieses Keyword keine KI-Übersicht.</p>`
    }</div>
  </div>`;
}

function renderCompetitors() {
  const p = state.project;
  if (!p.competitors?.length) {
    $("#competitors").innerHTML = `<p class="muted">Keine Suchergebnisse erhalten.</p>`;
    return;
  }
  const groups = { used: [], filtered: [], error: [], reserve: [] };
  p.competitors.forEach((c, i) => (groups[c.manualInclude ? "used" : c.status] || groups.filtered).push([c, i]));
  const words = (c) => (c.words ? c.words : c.text ? c.text.split(/\s+/).length : 0);
  const item = ([c, i], kind) => `
    <li class="cmp ${kind}">
      <span class="rank">${c.rank ?? "–"}</span>
      <span class="cmp-main"><span class="cmp-title">${esc(c.title || c.domain || c.url)}</span><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.domain || hostOf(c.url))}</a></span>
      <span class="cmp-info">${kind === "used" ? `${num(words(c))} Wörter` : esc(c.reason || "")}</span>
      ${kind === "used" ? `<button type="button" class="link" data-exclude="${i}">rausnehmen</button>` : c.text ? `<button type="button" class="link" data-include="${i}">trotzdem nutzen</button>` : ""}
    </li>`;
  $("#competitors").innerHTML = `
    <h3>Verglichen (${groups.used.length})</h3><ul>${groups.used.map((x) => item(x, "used")).join("")}</ul>
    ${groups.filtered.length ? `<h3>Automatisch aussortiert (${groups.filtered.length})</h3><ul>${groups.filtered.map((x) => item(x, "filtered")).join("")}</ul>` : ""}
    ${groups.error.length ? `<h3>Nicht ladbar (${groups.error.length})</h3><ul>${groups.error.map((x) => item(x, "error")).join("")}</ul>` : ""}
    ${groups.reserve.length ? `<details><summary>Reserve (${groups.reserve.length})</summary><ul>${groups.reserve.map((x) => item(x, "filtered")).join("")}</ul></details>` : ""}
    ${p.cost != null ? `<p class="muted small">Kosten der Google-Abfrage laut DataForSEO: ${fmt(p.cost, 4)} $</p>` : ""}`;
  $$("[data-exclude]").forEach((b) =>
    b.addEventListener("click", () => {
      Object.assign(p.competitors[b.dataset.exclude], { status: "filtered", reason: "Von dir rausgenommen", manualInclude: false });
      recompute();
      persist();
    })
  );
  $$("[data-include]").forEach((b) =>
    b.addEventListener("click", () => {
      Object.assign(p.competitors[b.dataset.include], { status: "used", manualInclude: true });
      recompute();
      persist();
    })
  );
}

function renderTable() {
  const { rows, comps } = state.ev;
  const own = !!state.ev.own && state.ev.own.total > 0;
  const kw = state.project.keyword.toLowerCase();
  const n = comps.length;
  const formsHtml = (r) => (r.forms.length > 1 ? `<span class="forms">${esc(r.forms.join(", "))}</span>` : "");
  const head = own
    ? `<tr><th>#</th><th>Begriff</th><th class="num">Konkurrenz Ø<br><small>WDF*IDF</small></th><th class="num">Konkurrenz max</th><th class="num">Du</th><th class="num">Genutzt von</th><th class="num">Du erwähnst</th><th class="num">Ziel</th><th>Empfehlung</th></tr>`
    : `<tr><th>#</th><th>Begriff</th><th class="num">Konkurrenz Ø<br><small>WDF*IDF</small></th><th class="num">Konkurrenz max</th><th class="num">Genutzt von</th><th class="num">Ø Erwähnungen</th><th class="num">Ziel bei ${num(opts().plannedWords)} Wörtern</th></tr>`;
  const body = rows
    .map((r, i) => {
      const cls = (kw && r.term.includes(kw) ? "kw " : "") + (r.generic ? "generic" : "");
      const tag = r.generic ? ` <span class="pill plan" title="Kommt in normaler Sprache genauso oft vor – fürs Ranking unwichtig">allgemein</span>` : "";
      return own
        ? `<tr class="${cls}" data-status="${r.status.key}" data-generic="${r.generic ? 1 : 0}"><td>${i + 1}</td><td class="term">${esc(r.term)}${tag}${formsHtml(r)}</td><td class="num">${fmt(r.avg)}</td><td class="num">${fmt(r.max)}</td><td class="num">${fmt(r.own)}</td><td class="num">${r.used}/${n}</td><td class="num">${r.fOwn}</td><td class="num">${r.target}</td><td><span class="pill ${r.status.key}">${ACTION_TXT[r.status.key](r)}</span></td></tr>`
        : `<tr class="${cls}" data-generic="${r.generic ? 1 : 0}"><td>${i + 1}</td><td class="term">${esc(r.term)}${tag}${formsHtml(r)}</td><td class="num">${fmt(r.avg)}</td><td class="num">${fmt(r.max)}</td><td class="num">${r.used}/${n}</td><td class="num">${fmt(r.avgCount, 1)}</td><td class="num">${r.target}×</td></tr>`;
    })
    .join("");
  $("#table").innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
  $("#filters").hidden = !own;
  applyFilter();
}

function applyFilter() {
  const f = $(".chip.active", $("#filters"))?.dataset.filter || "all";
  const showGeneric = $("#show-generic")?.checked;
  $$("#table tbody tr").forEach((tr) => (tr.hidden = (tr.dataset.generic === "1" && !showGeneric) || !(f === "all" || (f === "todo" ? tr.dataset.status !== "ok" : tr.dataset.status === f))));
}

function renderStructure() {
  $("#structure").innerHTML = state.ev.comps
    .map(
      (c) => `<details><summary><strong>${esc(c.title || c.domain)}</strong> · ${num(c.total)} Wörter · ${(c.h2 || []).length} H2</summary>
      ${c.h1 ? `<p class="muted">H1: ${esc(c.h1)}</p>` : ""}<ul>${(c.h2 || []).map((h) => `<li>${esc(h)}</li>`).join("") || "<li class='muted'>Keine H2 gefunden</li>"}</ul></details>`
    )
    .join("");
}

function renderChart(rows) {
  const hasOwn = !!state.ev.own && state.ev.own.total > 0;
  const kw = state.project.keyword.toLowerCase();
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
      ? list
          .map(
            (p) => `<li class="${p.id === state.project?.id ? "active" : ""}"><button type="button" class="proj" data-open="${p.id}"><strong>${esc(p.keyword)}</strong><span>${new Date(p.updatedAt).toLocaleDateString("de-DE")}${p.score != null ? ` · ${p.score} %` : ""}${p.source === "bot" ? " · 🤖" : ""}</span></button><button type="button" class="link del" data-del="${p.id}" title="Löschen">×</button></li>`
          )
          .join("")
      : `<li class="muted small">Noch keine Projekte. Nach der ersten Analyse wird automatisch gespeichert.</li>`;
    $$("[data-open]").forEach((b) => b.addEventListener("click", () => openProject(b.dataset.open)));
    $$("[data-del]").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!confirm("Projekt wirklich löschen?")) return;
        await api(`/api/projects/${b.dataset.del}`, { method: "DELETE" });
        if (state.project?.id === b.dataset.del) newAnalysis();
        loadProjectList();
      })
    );
  } catch {
    $("#projects").innerHTML = `<li class="muted small">Projekte nicht verfügbar.</li>`;
  }
}

async function openProject(id) {
  try {
    setStatus("Öffne Projekt …");
    const p = await api(`/api/projects/${id}`);
    setStatus("");
    $("#manual-urls").value = "";
    loadIntoUi(p);
    loadProjectList();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (err) {
    setStatus(err.message, true);
  }
}

function newAnalysis() {
  Object.assign(state, { project: null, ev: null, pendingLink: null });
  $("#form").reset();
  history.replaceState(null, "", location.pathname);
  syncOwnMode();
  syncInputMode();
  $("#results").hidden = true;
  $("#recheck").hidden = true;
  $("#recheck-text-wrap").hidden = true;
  $("#recheck-text").value = "";
  $("#saved-hint").textContent = "";
  setStatus("");
  loadProjectList();
}

/* ============ Export ============ */
function exportCsv() {
  const own = !!state.ev.own && state.ev.own.total > 0;
  const t = termTable(state.ev.rows, state.ev.comps.length);
  const lines = [["Begriff", "Schreibweisen", "Konkurrenz Ø WDF*IDF", "Konkurrenz max WDF*IDF", ...(own ? ["Du WDF*IDF", "Du erwähnst"] : []), "Genutzt von", "Ziel-Erwähnungen", "Empfehlung"]];
  for (const r of t) lines.push([r.term, r.forms.join(", "), fmt(r.wdfIdfCompetitorAvg), fmt(r.wdfIdfCompetitorMax), ...(own ? [fmt(r.wdfIdfYours), r.yourCount] : []), r.usedBy, r.target, r.action]);
  const csv = "﻿" + lines.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `wdf-idf-${state.project.keyword.replace(/[^\p{L}\p{N}]+/gu, "-")}.csv`;
  a.click();
}

/* ============ Start ============ */
$("#login-form").addEventListener("submit", login);
$("#logout").addEventListener("click", logout);
$("#form").addEventListener("submit", startAnalysis);
$("#recheck").addEventListener("click", recheck);
$("#new").addEventListener("click", newAnalysis);
$("#keyword").addEventListener("input", syncInputMode);
$("#kw-go").addEventListener("click", confirmKeyword);
$("#kw-pick").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    confirmKeyword();
  }
});
$$("input[name=ownmode]").forEach((r) => r.addEventListener("change", syncOwnMode));
["#bigrams", "#limit", "#coverage", "#planned"].forEach((id) => $(id).addEventListener("change", () => state.project && recompute()));
$("#csv").addEventListener("click", exportCsv);
$("#print").addEventListener("click", () => window.print());
$("#show-generic")?.addEventListener("change", applyFilter);
$$("#filters .chip").forEach((c) =>
  c.addEventListener("click", () => {
    $$("#filters .chip").forEach((x) => x.classList.toggle("active", x === c));
    applyFilter();
  })
);
boot();
