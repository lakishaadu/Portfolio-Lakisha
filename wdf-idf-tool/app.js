// WDF*IDF-Analyse – läuft komplett im Browser. Nur das Laden fremder Seiten geht über /api/fetch.

/* ---------------- Stoppwörter (DE + EN) ---------------- */
const STOP = new Set(`
aber alle allem allen aller alles als also am an ander andere anderem anderen anderer anderes anders auch auf aus bei beim bin bis bist bitte da dabei dadurch dafür dagegen daher dahin damals damit danach daneben dann daran darauf daraus darin darum darunter das dass daß dazu dein deine deinem deinen deiner dem den denen denn dennoch der deren derer des deshalb dessen dich die dies diese diesem diesen dieser dieses dir doch dort du durch eben ebenso eher ein eine einem einen einer eines einige einigen einiger einiges einmal er es etwa etwas euch euer eure für gab gibt ging gegen geht gewesen habe haben hat hatte hätte hatten hier hin hinter ich ihm ihn ihnen ihr ihre ihrem ihren ihrer ihres im immer in indem ins ist ja je jede jedem jeden jeder jedes jedoch jene jetzt kann kannst kein keine keinem keinen keiner können könnte machen man manche mehr mein meine meinem meinen meiner mich mir mit muss müssen musst nach nachdem neben nein nicht nichts noch nun nur ob oder ohne schon sehr sein seine seinem seinen seiner seit selbst sich sie sind so solche soll sollen sollte sondern sonst sowie über um und uns unser unsere unter viel viele vom von vor wann war waren warum was weil weiter welche welchem welchen welcher welches wenn wer werde werden wie wieder will wir wird wirst wo wobei wollen worden wurde würde wurden würden zu zum zur zwar zwischen beispielsweise z.b zb bzw usw etc ganz gut neue neuen neues erst ersten mal sowohl eigentlich wirklich gerade dabei oft einfach dir ihnen hierbei sodass deren dafür wichtig wichtige finden lassen gehen kommen sehen geben möchten möchte bereits genau natürlich zudem außerdem jedoch daher beim gibt immer ab per via
a about above after again against all am an and any are aren't as at be because been before being below between both but by can can't cannot could did do does doing don't down during each few for from further had has have having he her here hers herself him himself his how i if in into is isn't it it's its itself just let me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself also get got one two may might must us like make many much use used using well
`.trim().split(/\s+/));

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n, d = 3) => (Number.isFinite(n) ? n.toFixed(d).replace(".", ",") : "–");

/* ---------------- Text aus HTML holen ---------------- */
function extract(html, mode) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const title = doc.querySelector("title")?.textContent.trim() || "";
  const h1 = doc.querySelector("h1")?.textContent.trim() || "";
  const desc = doc.querySelector('meta[name="description"]')?.getAttribute("content") || "";
  doc.querySelectorAll("script,style,noscript,svg,iframe,template,canvas,form,button,select").forEach((n) => n.remove());
  let root = doc.body || doc.documentElement;
  if (mode === "main") {
    doc.querySelectorAll('nav,header,footer,aside,[role=navigation],[role=banner],[role=contentinfo],[aria-hidden=true],[class*="cookie" i],[id*="cookie" i],[class*="comment" i],[id*="comment" i],[class*="sidebar" i],[class*="related" i],[class*="newsletter" i],[class*="share" i],[class*="breadcrumb" i]').forEach((n) => n.remove());
    const cands = [...doc.querySelectorAll("article, main, [role=main], .entry-content, .post-content, .article-content, .content")];
    const best = cands.sort((a, b) => b.textContent.length - a.textContent.length)[0];
    if (best && best.textContent.trim().split(/\s+/).length > 150) root = best;
  }
  // Blockelemente mit Satzgrenzen versehen, damit keine Wortgruppen über Absätze hinweg entstehen
  root.querySelectorAll("p,li,h1,h2,h3,h4,h5,h6,td,th,div,br,dt,dd,blockquote,figcaption").forEach((n) => n.append(" . "));
  const h2 = [...doc.querySelectorAll("h2")].map((n) => n.textContent.replace(/\s+\.\s*$/, "").trim()).filter(Boolean);
  return { title, h1: h1.replace(/\s+\.\s*$/, ""), desc, h2, text: root.textContent.replace(/\s+/g, " ").trim() };
}

/* ---------------- Tokenisieren & zählen ---------------- */
const WORD = /[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu;

function analyzeText(text, useBigrams) {
  const counts = new Map();
  let total = 0;
  const add = (t) => counts.set(t, (counts.get(t) || 0) + 1);
  for (const sentence of text.split(/[.!?;:|•·\n]+/)) {
    const toks = (sentence.toLowerCase().match(WORD) || []).filter((t) => !/^\d+$/.test(t));
    total += toks.length;
    toks.forEach((t, i) => {
      const ok = (w) => w.length > 1 && !STOP.has(w);
      if (ok(t)) add(t);
      if (useBigrams && i > 0 && ok(t) && ok(toks[i - 1])) add(toks[i - 1] + " " + t);
    });
  }
  return { counts, total };
}

const wdf = (f, L) => (L > 1 && f > 0 ? Math.log2(f + 1) / Math.log2(L) : 0);

/* ---------------- Kernberechnung ---------------- */
function compute(own, comps, opts) {
  const docs = own ? [...comps, own] : comps;
  const N = docs.length;
  const df = new Map();
  for (const d of docs) for (const t of d.counts.keys()) df.set(t, (df.get(t) || 0) + 1);
  const idf = (t) => Math.log10(1 + N / (df.get(t) || 1));
  const L_own = own ? own.total : opts.plannedWords;

  const terms = new Set();
  for (const c of comps) for (const t of c.counts.keys()) terms.add(t);

  const minDocs = Math.max(1, Math.ceil((opts.minCoverage / 100) * comps.length));
  const rows = [];
  for (const t of terms) {
    const used = comps.filter((c) => c.counts.has(t)).length;
    if (used < minDocs) continue;
    const i = idf(t);
    const wdfs = comps.map((c) => wdf(c.counts.get(t) || 0, c.total));
    const avgW = wdfs.reduce((a, b) => a + b, 0) / comps.length;
    const maxW = Math.max(...wdfs);
    const fOwn = own ? own.counts.get(t) || 0 : 0;
    const ownW = own ? wdf(fOwn, own.total) : 0;
    // Wie oft muss das Wort vorkommen, damit der eigene WDF dem Ø der Konkurrenz entspricht?  f = L^WDF − 1
    const target = L_own > 1 ? Math.max(0, Math.round(Math.pow(L_own, avgW) - 1)) : 0;
    const maxF = L_own > 1 ? Math.max(0, Math.floor(Math.pow(L_own, maxW) - 1)) : 0;
    const avgCount = comps.reduce((a, c) => a + (c.counts.get(t) || 0), 0) / comps.length;
    rows.push({ term: t, used, idf: i, avg: avgW * i, max: maxW * i, own: ownW * i, fOwn, target, maxF: Math.max(maxF, target), avgCount });
  }
  rows.sort((a, b) => b.avg - a.avg);
  return rows.slice(0, opts.limit).map((r) => ({ ...r, status: status(r, !!own) }));
}

function status(r, hasOwn) {
  if (!hasOwn) return { key: "plan", label: `ca. ${r.target}×` };
  const diff = r.target - r.fOwn;
  if (r.fOwn === 0 && r.target > 0) return { key: "missing", label: "Fehlt", diff };
  if (r.fOwn > r.maxF && r.fOwn > 2) return { key: "over", label: "Zu oft", diff: r.maxF - r.fOwn };
  if (diff >= 2 || (diff >= 1 && r.fOwn < r.target * 0.7)) return { key: "low", label: "Zu wenig", diff };
  return { key: "ok", label: "Passt", diff: 0 };
}

/* ---------------- Laden ---------------- */
async function loadUrl(url) {
  const res = await fetch(`/api/fetch?url=${encodeURIComponent(url)}`);
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error("Lade-Dienst nicht erreichbar. Starte das Tool über „node server.mjs“ oder Netlify – oder füge den Text manuell ein.");
  }
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
  return data.html;
}

/* ---------------- UI ---------------- */
const state = { sources: [], rows: [], hasOwn: false };

function parseUrls(text) {
  return [...new Set(text.split(/\s+/).map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s)))];
}

function renderSources() {
  $("#sources").innerHTML = state.sources
    .map(
      (s, idx) => `
    <li class="src ${s.error ? "err" : ""}">
      <div class="src-head">
        <span class="badge ${s.own ? "own" : ""}">${s.own ? "Deine Seite" : "Konkurrenz"}</span>
        <span class="src-url" title="${esc(s.url)}">${esc(s.label)}</span>
        <span class="src-meta">${s.error ? "Fehler" : s.total ? `${s.total.toLocaleString("de-DE")} Wörter` : "lädt …"}</span>
      </div>
      ${s.title ? `<div class="src-title">${esc(s.title)}</div>` : ""}
      ${
        s.error
          ? `<div class="src-error">${esc(s.error)}</div>
             <details><summary>Text stattdessen manuell einfügen</summary>
               <textarea data-idx="${idx}" class="manual" rows="5" placeholder="Artikeltext hier einfügen …"></textarea>
               <button class="btn small" data-apply="${idx}">Übernehmen &amp; neu berechnen</button>
             </details>`
          : ""
      }
    </li>`
    )
    .join("");
  $("#sources").querySelectorAll("[data-apply]").forEach((b) =>
    b.addEventListener("click", () => {
      const i = Number(b.dataset.apply);
      const txt = $(`textarea[data-idx="${i}"]`).value.trim();
      if (!txt) return;
      Object.assign(state.sources[i], { error: null, text: txt, title: "Manuell eingefügter Text" });
      recompute();
    })
  );
}

function opts() {
  return {
    bigrams: $("#bigrams").checked,
    limit: Number($("#limit").value),
    minCoverage: Number($("#coverage").value),
    plannedWords: Number($("#planned").value) || 1200,
    mode: $("#mode").value,
  };
}

function recompute() {
  const o = opts();
  for (const s of state.sources) {
    if (s.error || (!s.html && !s.text)) continue;
    if (s.html && !s.manual) {
      const ex = extract(s.html, o.mode);
      Object.assign(s, { title: ex.title || s.title, h1: ex.h1, h2: ex.h2, text: ex.text });
    }
    const a = analyzeText(s.text, o.bigrams);
    s.counts = a.counts;
    s.total = a.total;
  }
  renderSources();
  const comps = state.sources.filter((s) => !s.own && s.counts && s.total > 0);
  const own = state.sources.find((s) => s.own && s.counts && s.total > 0) || null;
  state.hasOwn = !!own;
  if (comps.length < 2) {
    $("#results").hidden = true;
    $("#status").textContent = "Für einen Vergleich brauchst du mindestens 2 erfolgreich geladene Konkurrenz-Seiten.";
    return;
  }
  state.rows = compute(own, comps, o);
  state.own = own;
  state.comps = comps;
  $("#status").textContent = "";
  renderResults();
}

function renderResults() {
  const { rows, own, comps } = state;
  const kw = $("#keyword").value.trim().toLowerCase();
  $("#results").hidden = false;

  const avgLen = Math.round(comps.reduce((a, c) => a + c.total, 0) / comps.length);
  const missing = rows.filter((r) => r.status.key === "missing").length;
  const low = rows.filter((r) => r.status.key === "low").length;
  const over = rows.filter((r) => r.status.key === "over").length;
  const covered = rows.filter((r) => r.status.key === "ok").length;
  const score = own ? Math.round((covered / rows.length) * 100) : null;

  $("#summary").innerHTML = `
    <div class="tile"><div class="tile-label">Analysierte Konkurrenten</div><div class="tile-value">${comps.length}</div></div>
    <div class="tile"><div class="tile-label">Ø Wortanzahl Konkurrenz</div><div class="tile-value">${avgLen.toLocaleString("de-DE")}</div>
      ${own ? `<div class="tile-sub">Du: ${own.total.toLocaleString("de-DE")} Wörter</div>` : `<div class="tile-sub">Planung mit ${opts().plannedWords.toLocaleString("de-DE")} Wörtern</div>`}</div>
    ${
      own
        ? `<div class="tile"><div class="tile-label">Term-Abdeckung</div><div class="tile-value">${score} %</div><div class="tile-sub">${covered} von ${rows.length} Begriffen passen</div></div>
           <div class="tile"><div class="tile-label">To-dos</div><div class="tile-value">${missing + low + over}</div><div class="tile-sub">${missing} fehlen · ${low} zu wenig · ${over} zu oft</div></div>`
        : `<div class="tile"><div class="tile-label">Relevante Begriffe</div><div class="tile-value">${rows.length}</div><div class="tile-sub">Schreibvorlage für deinen Text</div></div>`
    }`;

  renderChart(rows.slice(0, 20), !!own, kw);

  const head = own
    ? `<tr><th>#</th><th>Begriff</th><th class="num">Konkurrenz Ø<br><small>WDF*IDF</small></th><th class="num">Konkurrenz max</th><th class="num">Du</th><th class="num">Ø Erwähnungen<br><small>Konkurrenz</small></th><th class="num">Du erwähnst</th><th class="num">Ziel</th><th>Empfehlung</th></tr>`
    : `<tr><th>#</th><th>Begriff</th><th class="num">Konkurrenz Ø<br><small>WDF*IDF</small></th><th class="num">Konkurrenz max</th><th class="num">Genutzt von</th><th class="num">Ø Erwähnungen<br><small>Konkurrenz</small></th><th class="num">Ziel bei ${opts().plannedWords} Wörtern</th></tr>`;
  const body = rows
    .map((r, i) => {
      const isKw = kw && (r.term === kw || r.term.includes(kw));
      const rec = (() => {
        if (!own) return "";
        const s = r.status;
        if (s.key === "missing") return `<span class="pill missing">Fehlt</span> ${r.target}× einbauen`;
        if (s.key === "low") return `<span class="pill low">Zu wenig</span> +${s.diff}× ergänzen`;
        if (s.key === "over") return `<span class="pill over">Zu oft</span> ${Math.abs(s.diff)}× reduzieren`;
        return `<span class="pill ok">Passt</span>`;
      })();
      return own
        ? `<tr class="${isKw ? "kw" : ""}" data-status="${r.status.key}"><td>${i + 1}</td><td class="term">${esc(r.term)}</td><td class="num">${fmt(r.avg)}</td><td class="num">${fmt(r.max)}</td><td class="num">${fmt(r.own)}</td><td class="num">${fmt(r.avgCount, 1)}</td><td class="num">${r.fOwn}</td><td class="num">${r.target}</td><td>${rec}</td></tr>`
        : `<tr class="${isKw ? "kw" : ""}"><td>${i + 1}</td><td class="term">${esc(r.term)}</td><td class="num">${fmt(r.avg)}</td><td class="num">${fmt(r.max)}</td><td class="num">${r.used}/${comps.length}</td><td class="num">${fmt(r.avgCount, 1)}</td><td class="num">${r.target}×</td></tr>`;
    })
    .join("");
  $("#table").innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
  $("#filters").hidden = !own;
  applyFilter();

  // Konkurrenz-Struktur (H2) als Inspiration
  $("#structure").innerHTML = comps
    .map(
      (c) => `<details><summary><strong>${esc(c.title || c.label)}</strong> · ${c.total.toLocaleString("de-DE")} Wörter · ${(c.h2 || []).length} H2</summary>
        ${c.h1 ? `<p class="muted">H1: ${esc(c.h1)}</p>` : ""}<ul>${(c.h2 || []).map((h) => `<li>${esc(h)}</li>`).join("") || "<li class='muted'>Keine H2 gefunden</li>"}</ul></details>`
    )
    .join("");
}

function applyFilter() {
  const f = document.querySelector(".chip.active")?.dataset.filter || "all";
  $("#table").querySelectorAll("tbody tr").forEach((tr) => {
    tr.hidden = !(f === "all" || (f === "todo" ? tr.dataset.status !== "ok" : tr.dataset.status === f));
  });
}

/* ---------------- Diagramm (Dot-Plot) ---------------- */
function renderChart(rows, hasOwn, kw) {
  const W = 760, rowH = 26, top = 34, left = 170, right = 20;
  const H = top + rows.length * rowH + 30;
  const maxV = Math.max(...rows.map((r) => Math.max(r.max, r.own)), 0.01);
  const x = (v) => left + (v / maxV) * (W - left - right);
  const ticks = 4;
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="WDF*IDF der Top-Begriffe: Konkurrenz Ø, Konkurrenz Maximum${hasOwn ? " und deine Seite" : ""}">`;
  for (let i = 0; i <= ticks; i++) {
    const v = (maxV / ticks) * i, xx = x(v);
    svg += `<line x1="${xx}" x2="${xx}" y1="${top - 8}" y2="${H - 26}" class="grid"/><text x="${xx}" y="${H - 8}" class="axis" text-anchor="middle">${fmt(v, 2)}</text>`;
  }
  rows.forEach((r, i) => {
    const y = top + i * rowH + rowH / 2;
    const tip = `${r.term} – Konkurrenz Ø ${fmt(r.avg)}, max ${fmt(r.max)}${hasOwn ? `, du ${fmt(r.own)} (${r.fOwn}× erwähnt, Ziel ${r.target}×)` : `, Ziel ${r.target}×`}`;
    svg += `<g class="row" data-tip="${esc(tip)}">
      <rect x="0" y="${y - rowH / 2}" width="${W}" height="${rowH}" class="hit"/>
      <text x="${left - 10}" y="${y + 4}" text-anchor="end" class="label ${kw && r.term.includes(kw) ? "kwl" : ""}">${esc(r.term.length > 24 ? r.term.slice(0, 23) + "…" : r.term)}</text>
      <line x1="${x(0)}" x2="${x(r.max)}" y1="${y}" y2="${y}" class="range"/>
      <rect x="${x(0)}" y="${y - 5}" width="${Math.max(2, x(r.avg) - x(0))}" height="10" rx="4" class="bar-avg"/>
      <line x1="${x(r.max)}" x2="${x(r.max)}" y1="${y - 6}" y2="${y + 6}" class="tick-max"/>
      ${hasOwn ? `<circle cx="${x(r.own)}" cy="${y}" r="5" class="dot-own"/>` : ""}
    </g>`;
  });
  svg += "</svg>";
  $("#chart").innerHTML = svg;
  $("#legend").innerHTML = `<span><i class="lg avg"></i>Konkurrenz Ø</span><span><i class="lg max"></i>Konkurrenz Maximum</span>${hasOwn ? `<span><i class="lg own"></i>Deine Seite</span>` : ""}`;
  const tipEl = $("#tip");
  $("#chart").querySelectorAll(".row").forEach((g) => {
    g.addEventListener("mousemove", (e) => {
      tipEl.textContent = g.dataset.tip;
      tipEl.hidden = false;
      const box = $("#chart-wrap").getBoundingClientRect();
      tipEl.style.left = Math.min(e.clientX - box.left + 12, box.width - 260) + "px";
      tipEl.style.top = e.clientY - box.top + 12 + "px";
    });
    g.addEventListener("mouseleave", () => (tipEl.hidden = true));
  });
}

/* ---------------- CSV ---------------- */
function exportCsv() {
  const own = state.hasOwn;
  const lines = [["Begriff", "Konkurrenz Ø WDF*IDF", "Konkurrenz max WDF*IDF", ...(own ? ["Du WDF*IDF", "Du erwähnst"] : []), "Ø Erwähnungen Konkurrenz", "Ziel-Erwähnungen", ...(own ? ["Empfehlung"] : [])]];
  for (const r of state.rows) {
    const rec = r.status.key === "missing" ? `${r.target}x einbauen` : r.status.key === "low" ? `+${r.status.diff}x ergänzen` : r.status.key === "over" ? `${Math.abs(r.status.diff)}x reduzieren` : "passt";
    lines.push([r.term, fmt(r.avg), fmt(r.max), ...(own ? [fmt(r.own), r.fOwn] : []), fmt(r.avgCount, 1), r.target, ...(own ? [rec] : [])]);
  }
  const csv = "﻿" + lines.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `wdf-idf-${($("#keyword").value || "analyse").replace(/\W+/g, "-")}.csv`;
  a.click();
}

/* ---------------- Start ---------------- */
async function run(e) {
  e.preventDefault();
  const ownUrl = $("#own-url").value.trim();
  const ownText = $("#own-text").value.trim();
  const compUrls = parseUrls($("#comp-urls").value).filter((u) => u !== ownUrl).slice(0, 20);
  if (compUrls.length < 2) {
    $("#status").textContent = "Bitte mindestens 2 Konkurrenz-Links eintragen (je eine Zeile).";
    return;
  }
  const label = (u) => {
    try { const x = new URL(u); return x.hostname.replace(/^www\./, "") + x.pathname; } catch { return u; }
  };
  state.sources = compUrls.map((u) => ({ url: u, label: label(u), own: false }));
  if (ownText) state.sources.unshift({ url: "", label: "Eingefügter Text", own: true, text: ownText, manual: true, title: "Dein eingefügter Entwurf" });
  else if (ownUrl) state.sources.unshift({ url: ownUrl, label: label(ownUrl), own: true });

  $("#run").disabled = true;
  $("#status").textContent = "Lade Seiten …";
  renderSources();
  let done = 0;
  const toLoad = state.sources.filter((s) => s.url && !s.manual);
  await Promise.all(
    toLoad.map(async (s) => {
      try {
        s.html = await loadUrl(s.url);
      } catch (err) {
        s.error = err.message;
      }
      done++;
      $("#status").textContent = `Lade Seiten … ${done}/${toLoad.length}`;
      renderSources();
    })
  );
  $("#run").disabled = false;
  recompute();
}

$("#form").addEventListener("submit", run);
["#bigrams", "#limit", "#coverage", "#planned", "#mode"].forEach((id) => $(id).addEventListener("change", () => state.sources.length && recompute()));
$("#keyword").addEventListener("input", () => state.rows.length && renderResults());
$("#csv").addEventListener("click", exportCsv);
document.querySelectorAll(".chip").forEach((c) =>
  c.addEventListener("click", () => {
    document.querySelectorAll(".chip").forEach((x) => x.classList.toggle("active", x === c));
    applyFilter();
  })
);
