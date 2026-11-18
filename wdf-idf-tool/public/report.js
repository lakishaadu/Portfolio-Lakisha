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
  const rows = compute(own && own.total > 0 ? own : null, comps, { ...o, minLength: len.low, keyword: project.keyword });
  const h2median = Math.round(median(comps.map((c) => (c.h2 || []).length)));
  const score = own && own.total > 0 ? coverageScore(rows) : null;
  const report = buildReport({ keyword: project.keyword, own: own && own.total > 0 ? own : null, comps, rows, len, h2median, score, history: project.history || [] });
  report.content = contentInsights({ keyword: project.keyword, comps, own: own && own.total > 0 ? own : null });
  const t = project.insights?.trend;
  report.trend = t ? { searchVolume: t.searchVolume, difficulty: t.difficulty, intent: t.intent, yearlyChange: t.yearlyChange, season: seasonality(t.monthly) } : null;
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
  const topic = rows.filter((r) => !r.generic);
  const byStatus = (k) => topic.filter((r) => r.status.key === k);
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

  const todo = topic.filter((r) => r.status.key === "missing" || r.status.key === "low").length;
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
    writingPlan: own ? [] : topic.slice(0, 30).map(term),
    checks,
  };
}

/** Kompakte Begriffsliste (für Bots / CSV). */
export function termTable(rows, compsCount) {
  return rows.map((r) => ({
    term: r.term,
    forms: r.forms,
    status: r.status.key,
    generic: !!r.generic,
    keyness: r.keyness,
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

/* ================= Was die Top-Artikel anders machen ================= */
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const med = (arr) => {
  const a = arr.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

/** Lesbarkeit nach Amstad (deutsche Flesch-Formel): 0 = sehr schwer, 100 = sehr leicht. */
export function readability(text) {
  const sentences = String(text || "").split(/[.!?\n]+/).map((x) => x.trim()).filter((x) => x.split(/\s+/).length >= 3);
  const words = sentences.flatMap((x) => x.match(/[\p{L}]+/gu) || []);
  if (words.length < 30) return null;
  const syl = words.reduce((a, w) => a + Math.max(1, (w.toLowerCase().match(/[aeiouyäöü]+/g) || []).length), 0);
  const asl = words.length / sentences.length, asw = syl / words.length;
  const score = Math.round(Math.max(0, Math.min(100, 180 - asl - 58.5 * asw)));
  const label = score >= 70 ? "leicht" : score >= 50 ? "mittel" : score >= 30 ? "anspruchsvoll" : "schwer";
  return { score, label, avgSentenceWords: Math.round(asl * 10) / 10 };
}

const YEAR = /\b20\d{2}\b/;
const NUMBER = /(^|\s)(\d{1,2})(\s|\.|:)/;
const QUESTION = /\?|^(wie|was|warum|wann|wo|welche|wer|kann|darf|soll)\b/i;

/** Format, Aktualität, Bilder, Listen, Lesbarkeit und Title-Ideen aus den Top-Artikeln ableiten. */
export function contentInsights({ keyword, comps, own }) {
  const titles = comps.map((c) => String(c.title || "").replace(/\s*[|–—-]\s*[^|–—-]+$/, "").trim()).filter(Boolean);
  const n = Math.max(1, titles.length);
  const numbers = titles.map((t) => Number((t.match(NUMBER) || [])[2])).filter((x) => x >= 3 && x <= 50);
  const numberShare = numbers.length / n;
  const yearShare = titles.filter((t) => YEAR.test(t)).length / n;
  const questionShare = titles.filter((t) => QUESTION.test(t)).length / n;
  const formatWords = ["tipps", "ideen", "anleitung", "guide", "checkliste", "ratgeber", "erfahrungen", "fakten"];
  const formatCounts = formatWords.map((w) => [w, titles.filter((t) => t.toLowerCase().includes(w)).length]).filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]);

  const now = Date.now();
  const ages = comps.map((c) => (c.modified ? (now - Date.parse(c.modified)) / (30.4 * 864e5) : NaN)).filter(Number.isFinite);
  const freshMonths = med(ages);
  const imgMed = med(comps.map((c) => c.images).filter((x) => x != null));
  const listShare = comps.filter((c) => (c.lists || 0) > 0).length / Math.max(1, comps.length);
  const tableShare = comps.filter((c) => (c.tables || 0) > 0).length / Math.max(1, comps.length);
  const readComp = med(comps.map((c) => readability(c.text)?.score));
  const readOwn = own?.text ? readability(own.text) : null;
  const pct = (x) => Math.round(x * 100);

  const tips = [];
  if (numberShare >= 0.4) tips.push({ type: "format", text: `${pct(numberShare)} % der Top-Artikel sind Listen mit Zahl im Titel (Ø ${Math.round(med(numbers))}). Ein Listen-Format („${Math.round(med(numbers))} Tipps …“) passt zur Suchabsicht.` });
  if (formatCounts.length) tips.push({ type: "format", text: `Häufige Formate in den Titeln: ${formatCounts.map(([w, c]) => `„${w[0].toUpperCase() + w.slice(1)}“ (${c}×)`).join(", ")}.` });
  if (questionShare >= 0.3) tips.push({ type: "format", text: `${pct(questionShare)} % der Titel sind Fragen – Google sieht hier eine Frage-Absicht. Beantworte die Frage gleich im ersten Absatz.` });
  if (yearShare >= 0.3) tips.push({ type: "fresh", text: `${pct(yearShare)} % der Titel enthalten eine Jahreszahl. Nimm die aktuelle Jahreszahl in Title/H1 auf und halte den Artikel aktuell.` });
  if (freshMonths != null) tips.push({ type: "fresh", text: freshMonths <= 12 ? `Die Top-Artikel wurden im Schnitt vor ca. ${Math.max(1, Math.round(freshMonths))} Monaten aktualisiert – Aktualität ist hier wichtig.` : `Die Top-Artikel sind im Schnitt ${Math.round(freshMonths / 12) <= 1 ? "etwa 1 Jahr" : `${Math.round(freshMonths / 12)} Jahre`} alt – mit einer frischen, aktualisierten Version hast du einen Vorteil.` });
  if (imgMed != null) {
    const ownImg = own?.kind === "url" ? own.images : null;
    tips.push({ type: "media", text: `Die Top-Artikel nutzen im Schnitt ${Math.round(imgMed)} Bilder${ownImg != null ? `, du ${ownImg}` : ""}.${ownImg != null && ownImg < imgMed - 1 ? " Ergänze eigene Fotos (mit beschreibendem Alt-Text)." : ""}` });
  }
  if (listShare >= 0.5) tips.push({ type: "media", text: `${pct(listShare)} % nutzen Aufzählungen${own?.kind === "url" && !own.lists ? " – bei dir fehlen sie. Aufzählungen erhöhen die Chance auf ein Featured Snippet." : "."}` });
  if (tableShare >= 0.3) tips.push({ type: "media", text: `${pct(tableShare)} % nutzen Tabellen${own?.kind === "url" && !own.tables ? " – eine Übersichtstabelle wäre ein Plus." : "."}` });
  if (readComp != null && readOwn) {
    const diff = readOwn.score - readComp;
    tips.push({ type: "read", text: `Lesbarkeit: du ${readOwn.score} (${readOwn.label}, Ø ${String(readOwn.avgSentenceWords).replace(".", ",")} Wörter pro Satz), Konkurrenz ${Math.round(readComp)}.${diff < -10 ? " Kürzere Sätze machen deinen Text leichter lesbar." : diff > 10 ? " Dein Text liest sich leichter als die Konkurrenz – gut so." : ""}` });
  }

  // Title-Ideen (zum Weiterdenken)
  const kw = String(keyword || "").trim();
  const Kw = kw.charAt(0).toUpperCase() + kw.slice(1);
  const year = new Date().getFullYear();
  const num = numbers.length ? Math.round(med(numbers)) : 7;
  const ideas = new Set();
  if (numberShare >= 0.3 || formatCounts.some(([w]) => w === "tipps")) ideas.add(`${Kw}: ${num} Tipps, die wirklich helfen${yearShare >= 0.3 ? ` (${year})` : ""}`);
  if (questionShare >= 0.2) ideas.add(`${Kw}? So gelingt es dir – mit ${num} Ideen`);
  ideas.add(`${Kw}: Der ehrliche Ratgeber${yearShare >= 0.3 ? ` ${year}` : ""}`);
  ideas.add(`${Kw} – ${num} Ideen & persönliche Erfahrungen`);
  const titleIdeas = [...ideas].slice(0, 3).map((t) => ({ title: t, length: t.length }));

  return {
    titles: { numberShare, yearShare, questionShare, medianNumber: numbers.length ? med(numbers) : null, formats: formatCounts },
    freshnessMonths: freshMonths != null ? Math.round(freshMonths) : null,
    images: { competitorMedian: imgMed, yours: own?.kind === "url" ? own.images ?? null : null },
    listShare,
    tableShare,
    readability: { yours: readOwn, competitorMedian: readComp },
    tips,
    titleIdeas,
  };
}

/** Saison-Auswertung aus monatlichen Suchvolumen (DataForSEO Labs). */
export function seasonality(monthly) {
  const pts = (monthly || []).filter((m) => Number.isFinite(m.search_volume)).sort((a, b) => a.year - b.year || a.month - b.month).slice(-12);
  if (pts.length < 6) return null;
  const avg = pts.reduce((a, m) => a + m.search_volume, 0) / pts.length;
  const peak = pts.reduce((a, m) => (m.search_volume > a.search_volume ? m : a), pts[0]);
  const ratio = avg ? peak.search_volume / avg : 1;
  const prep = MONTHS[(peak.month + 12 - 3) % 12];
  return {
    points: pts.map((m) => ({ label: `${MONTHS[m.month - 1].slice(0, 3)} ${String(m.year).slice(2)}`, month: m.month, value: m.search_volume })),
    peakMonth: MONTHS[peak.month - 1],
    seasonal: ratio >= 1.6,
    advice:
      ratio >= 1.6
        ? `Saison-Thema: Das Suchinteresse ist im ${MONTHS[peak.month - 1]} am höchsten (ca. ${ratio.toFixed(1).replace(".", ",")}× so hoch wie im Durchschnitt). Überarbeite und veröffentliche den Artikel spätestens im ${prep}, damit Google ihn rechtzeitig neu bewertet.`
        : `Ganzjahres-Thema: Das Suchinteresse ist über das Jahr relativ gleichmäßig. Regelmäßige Aktualisierungen lohnen sich jederzeit.`,
  };
}
