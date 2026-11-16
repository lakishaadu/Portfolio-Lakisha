// Reine Rechenlogik (ohne Oberfläche) – wird im Browser und in den Tests genutzt.

export const STOP = new Set(`
aber alle allem allen aller alles als also am an ander andere anderem anderen anderer anderes anders auch auf aus bei beim bin bis bist bitte da dabei dadurch dafür dagegen daher dahin damals damit danach daneben dann daran darauf daraus darin darum darunter das dass daß dazu dein deine deinem deinen deiner dem den denen denn dennoch der deren derer des deshalb dessen dich die dies diese diesem diesen dieser dieses dir doch dort du durch eben ebenso eher ein eine einem einen einer eines einige einigen einiger einiges einmal er es etwa etwas euch euer eure für gab gibt ging gegen geht gewesen habe haben hat hatte hätte hatten hier hin hinter ich ihm ihn ihnen ihr ihre ihrem ihren ihrer ihres im immer in indem ins ist ja je jede jedem jeden jeder jedes jedoch jene jetzt kann kannst kein keine keinem keinen keiner können könnte machen man manche mehr mein meine meinem meinen meiner mich mir mit muss müssen musst nach nachdem neben nein nicht nichts noch nun nur ob oder ohne schon sehr sein seine seinem seinen seiner seit selbst sich sie sind so solche soll sollen sollte sondern sonst sowie über um und uns unser unsere unter viel viele vom von vor wann war waren warum was weil weiter welche welchem welchen welcher welches wenn wer werde werden wie wieder will wir wird wirst wo wobei wollen worden wurde würde wurden würden zu zum zur zwar zwischen beispielsweise bzw usw etc ganz gut neue neuen neues erst ersten mal sowohl eigentlich wirklich gerade sodass hierbei finden lassen gehen kommen sehen geben möchten möchte bereits genau natürlich zudem außerdem ab per via dir dich euch uns sei seid wäre wären hast habt bist geworden worden wurden ihnen deren denen dieser jener jenes solcher solches dabei darauf hierzu hierfür somit wohl eher allerdings deshalb trotzdem ebenfalls stets meist meistens häufig selten oft jedoch einfach schnell klar beim dazu bspw ca inkl ggf evtl eigenen eigene eigener eigenes bieten bietet bietest dabei sollten sollte gibt gilt zeigt zeigen sowie hingegen bzw de com www https http html php
a about above after again against all am an and any are as at be because been before being below between both but by can cannot could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just let me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself also get got one two may might must us like make many much use used using well
`.trim().split(/\s+/));

const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

/** Zählt Wörter und (optional) Zweier-Wortgruppen. Wortgruppen entstehen nie über Satzgrenzen hinweg. */
export function analyzeText(text, useBigrams = true) {
  const counts = new Map();
  let total = 0;
  const add = (t) => counts.set(t, (counts.get(t) || 0) + 1);
  const ok = (w) => w.length > 1 && !STOP.has(w);
  for (const sentence of text.split(/[.!?;:|•·\n]+/)) {
    // Bindestrich-Wörter aufteilen: „Content-Marketing“ = „content marketing“
    const toks = (sentence.toLowerCase().replace(/(\p{L})[-‐–](?=\p{L})/gu, "$1 ").match(WORD) || []).filter((t) => !/^\d+$/.test(t));
    total += toks.length;
    toks.forEach((t, i) => {
      if (ok(t)) add(t);
      if (useBigrams && i > 0 && ok(t) && ok(toks[i - 1])) add(toks[i - 1] + " " + t);
    });
  }
  return { counts, total };
}

export const wdf = (f, L) => (L > 1 && f > 0 ? Math.log2(f + 1) / Math.log2(L) : 0);

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * own: {counts,total} | null, comps: [{counts,total}], opts: {limit, minCoverage (%), plannedWords}
 * Liefert die relevanten Begriffe mit Ziel-Häufigkeit und Empfehlung.
 */
export function compute(own, comps, opts) {
  const docs = own ? [...comps, own] : comps;
  const N = docs.length;
  const df = new Map();
  for (const d of docs) for (const t of d.counts.keys()) df.set(t, (df.get(t) || 0) + 1);
  const idf = (t) => Math.log10(1 + N / (df.get(t) || 1));
  // Ist dein Text kürzer als empfohlen, rechnen wir die Ziele für die empfohlene Mindestlänge.
  const L = own ? Math.max(own.total, opts.minLength || 0) : opts.plannedWords;

  const terms = new Set();
  for (const c of comps) for (const t of c.counts.keys()) terms.add(t);
  const minDocs = Math.max(2, Math.ceil((opts.minCoverage / 100) * comps.length));

  const rows = [];
  for (const t of terms) {
    const used = comps.reduce((a, c) => a + (c.counts.has(t) ? 1 : 0), 0);
    if (used < Math.min(minDocs, comps.length)) continue;
    const i = idf(t);
    const wdfs = comps.map((c) => wdf(c.counts.get(t) || 0, c.total));
    const avgW = wdfs.reduce((a, b) => a + b, 0) / comps.length;
    const maxW = Math.max(...wdfs);
    const fOwn = own ? own.counts.get(t) || 0 : 0;
    // Ziel: eigener WDF = Ø-WDF der Konkurrenz  ->  f = L^WDF − 1
    const target = L > 1 ? Math.max(1, Math.round(Math.pow(L, avgW) - 1)) : 1;
    const maxF = Math.max(target, L > 1 ? Math.floor(Math.pow(L, maxW) - 1) : 0);
    const avgCount = comps.reduce((a, c) => a + (c.counts.get(t) || 0), 0) / comps.length;
    rows.push({ term: t, used, idf: i, avg: avgW * i, max: maxW * i, own: own ? wdf(fOwn, own.total) * i : 0, fOwn, target, maxF, avgCount });
  }
  rows.sort((a, b) => b.avg - a.avg);
  return dedupe(rows).slice(0, opts.limit).map((r) => ({ ...r, status: status(r, !!own) }));
}

// Wenn „content marketing“ fast genauso stark ist wie „content“, beides behalten – aber Einzelwörter,
// die nur als Teil einer Wortgruppe vorkommen (gleiche Häufigkeit), nicht doppelt auflisten.
function dedupe(rows) {
  const bigrams = rows.filter((r) => r.term.includes(" "));
  return rows.filter((r) => {
    if (r.term.includes(" ")) return true;
    return !bigrams.some((b) => b.term.split(" ").includes(r.term) && Math.abs(b.avgCount - r.avgCount) < 0.01 && b.used === r.used);
  });
}

export function status(r, hasOwn) {
  if (!hasOwn) return { key: "plan", diff: r.target };
  const diff = r.target - r.fOwn;
  if (r.fOwn === 0) return { key: "missing", diff: r.target };
  if (r.fOwn > r.maxF && r.fOwn - r.maxF >= 2) return { key: "over", diff: r.maxF - r.fOwn };
  if (diff >= 2 || (diff >= 1 && r.fOwn < r.target * 0.67)) return { key: "low", diff };
  return { key: "ok", diff: 0 };
}

/** Gewichteter Abdeckungs-Score 0–100: wichtige Begriffe zählen mehr. */
export function coverageScore(rows) {
  let sum = 0, got = 0;
  for (const r of rows) {
    sum += r.avg;
    got += r.avg * Math.min(1, r.fOwn / Math.max(1, r.target));
  }
  return sum ? Math.round((got / sum) * 100) : 0;
}

export function lengthStats(comps) {
  const lens = comps.map((c) => c.total);
  const med = median(lens);
  return { median: Math.round(med), min: Math.min(...lens), max: Math.max(...lens), low: Math.round(med * 0.8 / 50) * 50, high: Math.round(med * 1.2 / 50) * 50 };
}

export { median };
