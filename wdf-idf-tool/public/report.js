// Gemeinsame Auswertung für Browser UND Server/Bot – so bekommen beide exakt dasselbe Ergebnis.
import { analyzeText, compute, coverageScore, lengthStats, median, termKey } from "./analysis.js";

export const DEFAULT_OPTS = { bigrams: true, limit: 50, minCoverage: 30, plannedWords: 1500 };

export const ACTION_TXT = {
  missing: (r) => `${r.target}× einbauen`,
  low: (r) => `+${r.status.diff}× ergänzen`,
  over: (r) => `${Math.abs(r.status.diff)}× reduzieren`,
  ok: () => "passt",
  plan: (r) => `ca. ${r.target}× verwenden`,
};

/** Wertet ein Projekt aus (Konkurrenz-Texte + eigener Text) und liefert Begriffe + Bericht. */
export function evaluate(project, options = {}) {
  const o = { ...DEFAULT_OPTS, ...options };
  const comps = (project.competitors || []).filter((c) => (c.status === "used" || c.manualInclude) && c.text);
  if (comps.length < 2) return { ok: false, comps, reason: comps.length ? "too_few" : "none" };
  for (const c of comps) Object.assign(c, analyzeText(c.text, o.bigrams));
  const own = project.own?.text ? Object.assign(project.own, analyzeText(project.own.text, o.bigrams)) : null;
  const len = lengthStats(comps);
  const rows = compute(own && own.total > 0 ? own : null, comps, { ...o, minLength: len.low });
  const h2median = Math.round(median(comps.map((c) => (c.h2 || []).length)));
  const score = own && own.total > 0 ? coverageScore(rows) : null;
  const report = buildReport({ keyword: project.keyword, own: own && own.total > 0 ? own : null, comps, rows, len, h2median, score, history: project.history || [] });
  return { ok: true, comps, own, rows, len, h2median, score, report };
}

function countKeyword(own, kw) {
  const words = kw.split(/\s+/).filter(Boolean);
  if (words.length <= 2) {
    const n = own.counts.get(termKey(kw)) || 0;
    if (n) return n;
  }
  return own.text.toLowerCase().split(kw).length - 1;
}

export function buildReport({ keyword, own, comps, rows, len, h2median, score, history }) {
  const kw = String(keyword || "").toLowerCase().trim();
  const byStatus = (k) => rows.filter((r) => r.status.key === k);
  const term = (r) => ({ term: r.term, forms: r.forms, usedBy: `${r.used}/${comps.length}`, yourCount: r.fOwn, target: r.target, action: ACTION_TXT[r.status.key](r) });
  const prev = history.length > 1 ? history[history.length - 2] : null;

  const checks = [];
  if (own) {
    const n = countKeyword(own, kw);
    checks.push({ ok: n > 0, label: `Keyword „${keyword}“ kommt im Text vor`, value: n ? `${n}× (inkl. Wortformen)` : "fehlt" });
    const first = own.text.toLowerCase().split(/\s+/).slice(0, 100).join(" ");
    const firstOk = first.includes(kw) || kw.split(/\s+/).every((w) => first.includes(w.slice(0, Math.max(4, w.length - 2))));
    checks.push({ ok: firstOk, label: "Keyword in den ersten 100 Wörtern", value: firstOk ? "ja" : "nein" });
    checks.push({ ok: own.total >= len.low, label: `Textlänge (Empfehlung ${len.low.toLocaleString("de-DE")}–${len.high.toLocaleString("de-DE")} Wörter)`, value: `${own.total.toLocaleString("de-DE")} Wörter` });
    const h2n = (own.h2 || []).length;
    checks.push({ ok: h2n >= Math.max(2, h2median - 2), label: `Zwischenüberschriften (Konkurrenz Ø ${h2median})`, value: own.kind === "text" ? `ca. ${h2n} erkannt` : `${h2n} H2` });
    if (own.kind === "url") {
      checks.push({ ok: (own.title || "").toLowerCase().includes(kw), label: "Keyword im Seitentitel (Title)", value: own.title ? "" : "kein Title" });
      checks.push({ ok: (own.h1 || "").toLowerCase().includes(kw), label: "Keyword in der Hauptüberschrift (H1)", value: own.h1 ? "" : "keine H1" });
      checks.push({ ok: (own.desc || "").toLowerCase().includes(kw), label: "Keyword in der Meta-Description", value: own.desc ? "" : "keine Description" });
    }
  }

  const todo = rows.filter((r) => r.status.key === "missing" || r.status.key === "low").length;
  let verdict;
  if (!own) verdict = { level: "plan", headline: "Schreibvorlage", text: `Noch kein eigener Text: Plane etwa ${len.median.toLocaleString("de-DE")} Wörter und arbeite die Begriffe ein.` };
  else if (score >= 85) verdict = { level: "good", headline: "Stark!", text: `Dein Text deckt die Themen der Konkurrenz sehr gut ab.${todo ? ` Mit ${todo} kleinen Ergänzungen holst du das letzte Stück raus.` : ""}` };
  else if (score >= 65) verdict = { level: "mid", headline: "Gute Basis.", text: `${todo} Begriffe fehlen oder sind zu schwach – damit schließt du die Lücke zur Konkurrenz.` };
  else verdict = { level: "bad", headline: "Hier steckt viel Potenzial drin.", text: `${todo} Begriffe fehlen oder sind zu schwach. Fang mit „Fehlt komplett“ an – das sind die wichtigsten.` };

  return {
    keyword,
    date: new Date().toISOString(),
    competitorsCompared: comps.length,
    coverageScore: score,
    previousScore: prev ? prev.score : null,
    verdict,
    length: { yours: own ? own.total : null, recommendedMin: len.low, recommendedMax: len.high, competitorMedian: len.median },
    targetsBasedOnWords: own ? Math.max(own.total, len.low) : null,
    missing: byStatus("missing").map(term),
    tooFew: byStatus("low").map(term),
    tooMany: byStatus("over").map(term),
    ok: byStatus("ok").map((r) => r.term),
    writingPlan: own ? [] : rows.slice(0, 30).map(term),
    checks,
  };
}

/** Kompakte Begriffsliste (für Bots / CSV). */
export function termTable(rows, compsCount) {
  return rows.map((r) => ({
    term: r.term,
    forms: r.forms,
    status: r.status.key,
    action: ACTION_TXT[r.status.key](r),
    yourCount: r.fOwn,
    target: r.target,
    usedBy: `${r.used}/${compsCount}`,
    competitorAvgCount: Math.round(r.avgCount * 10) / 10,
    wdfIdfCompetitorAvg: Math.round(r.avg * 1000) / 1000,
    wdfIdfCompetitorMax: Math.round(r.max * 1000) / 1000,
    wdfIdfYours: Math.round(r.own * 1000) / 1000,
  }));
}
