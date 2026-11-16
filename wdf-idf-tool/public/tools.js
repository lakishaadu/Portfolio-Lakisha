// Reiter: Rankings, Keyword-Ideen, Backlinks, KI-Sichtbarkeit, Einstellungen
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (n) => (n == null ? "–" : Number(n).toLocaleString("de-DE"));
const usd = (n) => (n == null ? "–" : `${Number(n).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} $`);
const date = (d) => (d ? new Date(d).toLocaleDateString("de-DE") : "–");
const INTENT = { informational: "Info", navigational: "Navigation", commercial: "Kommerziell", transactional: "Kauf" };

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, credentials: "same-origin", ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error("Bitte neu anmelden (Seite neu laden).");
  if (!res.ok && res.status !== 202) throw new Error(data.error || `Fehler ${res.status}`);
  return data;
}

let settings = { domains: [], monthlyBudgetUsd: 10 };

/* ================= Reiter ================= */
function showTab(name) {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  $$(".tabpane").forEach((p) => (p.hidden = p.id !== `tab-${name}`));
  if (name === "rankings") loadRankings();
  if (name === "ki") loadAiSummary();
  if (name === "einstellungen") loadSettings();
  try { sessionStorage.setItem("wdf-tab", name); } catch {}
}
$$(".tab").forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));

/** Von anderen Reitern aus eine WDF*IDF-Analyse vorbereiten. */
function goAnalyse(keyword) {
  showTab("analyse");
  $("#new")?.click();
  $("#keyword").value = keyword;
  $("#keyword").dispatchEvent(new Event("input"));
  $("#keyword").focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ================= Einstellungen ================= */
async function loadSettings() {
  const s = await api("/api/settings");
  settings = s;
  fillDomainSelects();
  $("#set-domains").value = s.domains.join("\n");
  $("#set-budget").value = s.monthlyBudgetUsd;
  const u = s.usage || {};
  const areas = Object.entries(u.byArea || {}).sort((a, b) => b[1] - a[1]);
  $("#usage").innerHTML = `<div class="kpis">
      <div class="kpi"><b>${usd(u.totalUsd || 0)}</b><span>verbraucht</span></div>
      <div class="kpi"><b>${usd(s.budget.left)}</b><span>übrig im Budget</span></div>
      <div class="kpi"><b>${num(u.calls || 0)}</b><span>Abfragen</span></div>
      <div class="kpi"><b>${usd(s.monthlyBudgetUsd)}</b><span>Monatsbudget</span></div>
    </div>${areas.length ? `<table><tbody>${areas.map(([a, v]) => `<tr><td>${esc(a)}</td><td class="num">${usd(v)}</td></tr>`).join("")}</tbody></table>` : ""}`;
}
$("#set-save").addEventListener("click", async () => {
  $("#set-status").textContent = "Speichere …";
  try {
    settings = await api("/api/settings", { method: "PUT", body: { domains: $("#set-domains").value.split(/[\s,]+/).filter(Boolean), monthlyBudgetUsd: Number($("#set-budget").value) } });
    $("#set-status").textContent = "Gespeichert.";
    loadSettings();
  } catch (err) {
    $("#set-status").textContent = err.message;
  }
});

function fillDomainSelects() {
  const opts = settings.domains.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join("");
  $$(".domain-select").forEach((sel) => {
    const keepEmpty = sel.querySelector('option[value=""]');
    const cur = sel.value;
    sel.innerHTML = (keepEmpty ? '<option value="">(keine Domain)</option>' : "") + opts;
    if (cur && settings.domains.includes(cur)) sel.value = cur;
  });
  $("#rk-domain").innerHTML = opts;
}

/* ================= Rankings ================= */
function sparkline(hist) {
  const pts = hist.filter((h) => h.position != null).slice(-12);
  if (pts.length < 2) return "";
  const W = 90, H = 24, max = 30;
  const xy = pts.map((h, i) => `${(i / (pts.length - 1)) * W},${(Math.min(h.position, max) / max) * (H - 4) + 2}`).join(" ");
  return `<svg class="spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-label="Positionsverlauf"><polyline points="${xy}"/></svg>`;
}

async function loadRankings() {
  try {
    const { items } = await api("/api/rankings");
    if (!items.length) {
      $("#rk-table").innerHTML = `<tbody><tr><td class="muted">Noch keine Keywords. Füge oben welche hinzu – oder nutze „Beobachten“ bei Keyword-Ideen.</td></tr></tbody>`;
      return;
    }
    const rows = items.map((t) => {
      const h = t.history || [];
      const last = h.at(-1), prev = h.at(-2);
      let delta = "";
      if (last?.position != null && prev?.position != null && last.position !== prev.position) {
        const d = prev.position - last.position;
        delta = `<span class="${d > 0 ? "up" : "down"}">${d > 0 ? "▲" : "▼"} ${Math.abs(d)}</span>`;
      }
      const pos = !last ? `<span class="muted">noch nicht geprüft</span>` : last.position != null ? `<span class="pos">#${last.position}</span> ${delta}` : `<span class="muted">nicht in Top 30</span>`;
      return `<tr>
        <td class="term">${esc(t.keyword)}<span class="forms">${esc(t.domain)}</span></td>
        <td>${pos}</td>
        <td>${sparkline(h)}</td>
        <td class="small">${last?.url ? `<a href="${esc(last.url)}" target="_blank" rel="noopener">${esc(last.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 50))}</a>` : ""}</td>
        <td class="small muted">${(last?.top3 || []).map(esc).join(", ")}</td>
        <td class="small">${last ? (last.aiOverview ? (last.aiCited ? "✓ zitiert" : "KI-Übersicht") : "–") : ""}</td>
        <td class="small muted">${date(t.lastChecked)}</td>
        <td><button type="button" class="link" data-analyse="${esc(t.keyword)}">Analysieren</button> · <button type="button" class="link del-rk" data-id="${t.id}">entfernen</button></td>
      </tr>`;
    });
    $("#rk-table").innerHTML = `<thead><tr><th>Keyword</th><th>Position</th><th>Verlauf</th><th>Rankende Seite</th><th>Top 3</th><th>KI</th><th>Geprüft</th><th></th></tr></thead><tbody>${rows.join("")}</tbody>`;
    $$("#rk-table .del-rk").forEach((b) => b.addEventListener("click", async () => {
      await api(`/api/rankings/${b.dataset.id}`, { method: "DELETE" });
      loadRankings();
    }));
    $$("#rk-table [data-analyse]").forEach((b) => b.addEventListener("click", () => goAnalyse(b.dataset.analyse)));
  } catch (err) {
    $("#rk-table").innerHTML = `<tbody><tr><td class="error-text">${esc(err.message)}</td></tr></tbody>`;
  }
}

async function track(keywords, domain) {
  return api("/api/rankings", { method: "POST", body: { keywords, domain: domain || settings.domains[0] } });
}

$("#rk-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const kws = $("#rk-keyword").value.split(",").map((s) => s.trim()).filter(Boolean);
  if (!kws.length) return;
  $("#rk-status").textContent = "";
  try {
    await track(kws, $("#rk-domain").value);
    $("#rk-keyword").value = "";
    loadRankings();
    $("#rk-status").textContent = "Hinzugefügt. Geprüft wird am Montag – oder klick auf „Jetzt alle prüfen“.";
  } catch (err) {
    $("#rk-status").textContent = err.message;
  }
});

$("#rk-check").addEventListener("click", async () => {
  $("#rk-check").disabled = true;
  $("#rk-status").textContent = "Prüfung läuft im Hintergrund …";
  try {
    await api("/api/rankings/check", { method: "POST", body: {} });
    // Ergebnisse nach und nach abholen
    let n = 0;
    const timer = setInterval(async () => {
      n++;
      await loadRankings();
      if (n >= 12) {
        clearInterval(timer);
        $("#rk-check").disabled = false;
        $("#rk-status").textContent = "Fertig (bei sehr vielen Keywords ggf. später neu laden).";
      }
    }, 15000);
  } catch (err) {
    $("#rk-check").disabled = false;
    $("#rk-status").textContent = err.message;
  }
});

/* ================= Recherche-Formulare ================= */
const RENDER = {
  "keyword-ideas": (d) =>
    table(
      ["Keyword", "Suchvolumen", "Schwierigkeit", "Absicht", "CPC", ""],
      d.items.map((i) => [`<strong>${esc(i.keyword)}</strong>`, num(i.searchVolume), difficulty(i.difficulty), esc(INTENT[i.intent] || i.intent || "–"), i.cpc != null ? `${i.cpc.toFixed(2).replace(".", ",")} $` : "–", actions(i.keyword)])
    ),
  "content-gap": (d) =>
    `<p class="small">Keywords, für die <strong>${esc(d.competitor)}</strong> rankt – <strong>${esc(d.own)}</strong> aber nicht:</p>` +
    table(
      ["Keyword", "Suchvolumen", "Schwierigkeit", "Position Konkurrenz", ""],
      d.items.map((i) => [`<strong>${esc(i.keyword)}</strong>${i.competitorUrl ? `<span class="forms">${esc(i.competitorUrl.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60))}</span>` : ""}`, num(i.searchVolume), difficulty(i.difficulty), i.competitorRank ? `#${i.competitorRank}` : "–", actions(i.keyword)])
    ),
  "ranked-keywords": (d) =>
    `<p class="small">${num(d.total)} Keywords insgesamt – hier die ${d.items.length} mit dem meisten Suchvolumen:</p>` +
    table(
      ["Keyword", "Position", "Suchvolumen", "Seite", ""],
      d.items.map((i) => [`<strong>${esc(i.keyword)}</strong>`, i.rank ? `<span class="pos">#${i.rank}</span>` : "–", num(i.searchVolume), i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener" class="small">${esc(i.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 50))}</a>` : "", actions(i.keyword)])
    ),
  backlinks: (d) => {
    const s = d.summary;
    return `<div class="kpis">
        <div class="kpi"><b>${num(s.referringDomains)}</b><span>verlinkende Domains</span></div>
        <div class="kpi"><b>${num(s.backlinks)}</b><span>Backlinks</span></div>
        <div class="kpi"><b>${num(s.rank)}</b><span>Domain-Stärke (0–100)</span></div>
        <div class="kpi"><b>${num(s.spamScore)}</b><span>Spam-Score</span></div>
      </div>
      <h3>Stärkste verlinkende Domains</h3>${rdTable(d.topDomains)}
      <h3 style="margin-top:16px">Neueste verlinkende Domains</h3>${rdTable(d.newestDomains)}`;
  },
  "link-gap": (d) =>
    `<p class="small">Diese Domains verlinken auf ${d.competitors.map((c) => `<strong>${esc(c)}</strong>`).join(", ")} – aber nicht auf <strong>${esc(d.own)}</strong>:</p>` +
    table(
      ["Domain", "Stärke", "Verlinkt auf"],
      d.items.map((i) => [`<a href="https://${esc(i.domain)}" target="_blank" rel="noopener"><strong>${esc(i.domain)}</strong></a>`, num(i.rank), i.linksTo.map((l) => `${esc(l.competitor)} (${num(l.backlinks)})`).join(", ")])
    ),
  "ai-mentions": (d) =>
    d.items.length
      ? d.items
          .map(
            (i) => `<details class="ai-item"><summary><strong>${esc(i.question)}</strong> <span class="muted small">· ${num(i.aiSearchVolume)} KI-Suchen${i.ownCited === true ? " · ✓ deine Domain zitiert" : ""}</span></summary>
              <p class="small">${esc(i.answer)}${i.answer.length >= 600 ? " …" : ""}</p>
              <p class="small muted">Quellen: ${i.sources.map((s) => esc(s.domain)).join(", ") || "–"}</p></details>`
          )
          .join("")
      : `<p class="muted">Keine Erwähnungen gefunden. Hinweis: Für Deutschland liefert DataForSEO hier eventuell (noch) wenige oder keine Daten.</p>`,
};

const difficulty = (v) => (v == null ? "–" : `<span class="pill ${v >= 60 ? "missing" : v >= 30 ? "low" : "ok"}">${v}</span>`);
const actions = (kw) => `<button type="button" class="link" data-analyse="${esc(kw)}">Analysieren</button> · <button type="button" class="link" data-track="${esc(kw)}">Beobachten</button>`;
const table = (head, rows) =>
  rows.length
    ? `<div class="table-wrap"><table><thead><tr>${head.map((h, i) => `<th class="${i > 0 && i < head.length - 1 ? "num" : ""}">${h}</th>`).join("")}</tr></thead><tbody>${rows
        .map((r) => `<tr>${r.map((c, i) => `<td class="${i > 0 && i < r.length - 1 ? "num" : ""}">${c}</td>`).join("")}</tr>`)
        .join("")}</tbody></table></div>`
    : `<p class="muted">Keine Ergebnisse.</p>`;
const rdTable = (list) =>
  table(["Domain", "Stärke", "Backlinks", "Erstmals gesehen"], (list || []).map((i) => [`<a href="https://${esc(i.domain)}" target="_blank" rel="noopener">${esc(i.domain)}</a>`, num(i.rank), num(i.backlinks), date(i.firstSeen)]));

async function runResearch(form, refresh = false) {
  const type = form.dataset.research;
  const out = $(`#out-${type}`);
  const fd = Object.fromEntries(new FormData(form).entries());
  if (type === "link-gap") fd.competitors = String(fd.competitors || "").split(/[\s,]+/).filter(Boolean);
  const btn = form.querySelector("button[type=submit]");
  btn.disabled = true;
  out.innerHTML = `<p class="muted">Lade … (DataForSEO-Abfrage)</p>`;
  try {
    const d = await api(`/api/research/${type}`, { method: "POST", body: { ...fd, refresh } });
    out.innerHTML =
      `<div class="meta-line"><span>${d.fromCache ? `Gespeichertes Ergebnis vom ${new Date(d.fetchedAt).toLocaleString("de-DE")} – kostenlos` : `Kosten dieser Abfrage: ${usd(d.cost)}`}</span>${
        d.fromCache ? `<button type="button" class="link refresh">Neu abfragen (kostet)</button>` : ""
      }</div>` + RENDER[type](d);
    out.querySelector(".refresh")?.addEventListener("click", () => runResearch(form, true));
    out.querySelectorAll("[data-analyse]").forEach((b) => b.addEventListener("click", () => goAnalyse(b.dataset.analyse)));
    out.querySelectorAll("[data-track]").forEach((b) =>
      b.addEventListener("click", async () => {
        try {
          await track([b.dataset.track], form.querySelector("[name=own],[name=domain]")?.value);
          b.textContent = "✓ beobachtet";
          b.disabled = true;
        } catch (err) {
          b.textContent = err.message;
        }
      })
    );
  } catch (err) {
    out.innerHTML = `<p class="error-text">${esc(err.message)}</p>`;
  } finally {
    btn.disabled = false;
  }
}
$$("form[data-research]").forEach((f) => f.addEventListener("submit", (e) => (e.preventDefault(), runResearch(f))));

/* ================= KI-Übersichten aus Analysen ================= */
async function loadAiSummary() {
  const out = $("#out-ai-summary");
  try {
    const list = await api("/api/research/ai-overview-summary");
    if (!list.length) {
      out.innerHTML = `<p class="muted">Noch keine Daten – führe zuerst Analysen durch (nur neue Analysen enthalten diese Infos).</p>`;
      return;
    }
    const withAio = list.filter((x) => x.aiOverview).length;
    const cited = list.filter((x) => x.ownCited).length;
    out.innerHTML = `<div class="kpis">
        <div class="kpi"><b>${list.length}</b><span>analysierte Keywords</span></div>
        <div class="kpi"><b>${withAio}</b><span>mit KI-Übersicht</span></div>
        <div class="kpi"><b>${cited}</b><span>davon zitieren dich</span></div>
        <div class="kpi"><b>${list.filter((x) => x.ownPosition && x.ownPosition <= 10).length}</b><span>Keywords in Top 10</span></div>
      </div>` + table(["Keyword", "Deine Position", "KI-Übersicht", "Zitierte Domains"], list.map((x) => [`<strong>${esc(x.keyword)}</strong>`, x.ownPosition ? `#${x.ownPosition}` : "–", x.aiOverview ? (x.ownCited ? "✓ du wirst zitiert" : "ja, ohne dich") : "keine", `<span class="small">${x.citedDomains.map(esc).join(", ")}</span>`]));
  } catch (err) {
    out.innerHTML = `<p class="error-text">${esc(err.message)}</p>`;
  }
}

/* ================= Start ================= */
async function init() {
  if ($("#app").hidden) return; // noch nicht angemeldet
  try {
    settings = await api("/api/settings");
    fillDomainSelects();
  } catch {
    /* noch nicht angemeldet – app.js zeigt den Login */
  }
  let saved = "analyse";
  try { saved = sessionStorage.getItem("wdf-tab") || "analyse"; } catch {}
  if (saved !== "analyse" && $(`#tab-${saved}`)) showTab(saved);
}
// Nach Login erneut initialisieren
new MutationObserver(() => !$("#app").hidden && init()).observe($("#app"), { attributes: true, attributeFilter: ["hidden"] });
init();
