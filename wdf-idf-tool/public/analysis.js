// Reine Rechenlogik (ohne Oberfläche) – wird im Browser und auf dem Server genutzt.
import { GENERAL_PPM, STOPWORDS_ISO } from "./general-de.js";

export const STOP = new Set(`
aber alle allem allen aller alles als also am an ander andere anderem anderen anderer anderes anders auch auf aus bei beim bin bis bist bitte da dabei dadurch dafür dagegen daher dahin damals damit danach daneben dann daran darauf daraus darin darum darunter das dass daß dazu dein deine deinem deinen deiner dem den denen denn dennoch der deren derer des deshalb dessen dich die dies diese diesem diesen dieser dieses dir doch dort du durch eben ebenso eher ein eine einem einen einer eines einige einigen einiger einiges einmal er es etwa etwas euch euer eure für gab gibt ging gegen geht gewesen habe haben hat hatte hätte hatten hier hin hinter ich ihm ihn ihnen ihr ihre ihrem ihren ihrer ihres im immer in indem ins ist ja je jede jedem jeden jeder jedes jedoch jene jetzt kann kannst kein keine keinem keinen keiner können könnte machen man manche mehr mein meine meinem meinen meiner mich mir mit muss müssen musst nach nachdem neben nein nicht nichts noch nun nur ob oder ohne schon sehr sein seine seinem seinen seiner seit selbst sich sie sind so solche soll sollen sollte sondern sonst sowie über um und uns unser unsere unter viel viele vom von vor wann war waren warum was weil weiter welche welchem welchen welcher welches wenn wer werde werden wie wieder will wir wird wirst wo wobei wollen worden wurde würde wurden würden zu zum zur zwar zwischen beispielsweise bzw usw etc ganz gut neue neuen neues erst ersten mal sowohl eigentlich wirklich gerade sodass hierbei finden lassen gehen kommen sehen geben möchten möchte bereits genau natürlich zudem außerdem ab per via dir dich euch uns sei seid wäre wären hast habt bist geworden worden wurden ihnen deren denen dieser jener jenes solcher solches dabei darauf hierzu hierfür somit wohl eher allerdings deshalb trotzdem ebenfalls stets meist meistens häufig selten oft jedoch einfach schnell klar beim dazu bspw ca inkl ggf evtl eigenen eigene eigener eigenes bieten bietet bietest dabei sollten sollte gibt gilt zeigt zeigen sowie hingegen bzw de com www https http html php
a about above after again against all am an and any are as at be because been before being below between both but by can cannot could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just let me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself also get got one two may might must us like make many much use used using well
`.trim().split(/\s+/));

const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

/* ---------- Wortformen zusammenführen: deutscher Snowball-Stemmer ---------- */
const V = "aeiouyäöü";
const isV = (c) => V.includes(c);
const S_END = "bdfghklmnrtp"; // gültige Buchstaben vor Plural-s (+p für „Tipps“, „Apps“)
const ST_END = "bdfghklmnt";
const stemCache = new Map();

export function stemDe(word) {
  if (word.length < 4 || /\d/.test(word)) return word;
  const cached = stemCache.get(word);
  if (cached) return cached;
  let w = word.replace(/ß/g, "ss");
  // u/y zwischen Vokalen markieren
  w = w.replace(/([aeiouyäöü])u(?=[aeiouyäöü])/g, "$1U").replace(/([aeiouyäöü])y(?=[aeiouyäöü])/g, "$1Y");
  const region = (str, from) => {
    for (let i = from + 1; i < str.length; i++) if (!isV(str[i]) && isV(str[i - 1])) return i + 1;
    return str.length;
  };
  let r1 = Math.max(3, region(w, 0));
  const r2 = region(w, r1);
  const inR = (suffixLen, r) => w.length - suffixLen >= r;

  // Schritt 1
  let m = w.match(/(ern|em|er|en|es|e|s)$/);
  if (m) {
    const suf = m[1];
    if (inR(suf.length, r1)) {
      if (["em", "ern", "er"].includes(suf)) w = w.slice(0, -suf.length);
      else if (["e", "en", "es"].includes(suf)) {
        w = w.slice(0, -suf.length);
        if (w.endsWith("niss")) w = w.slice(0, -1);
      } else if (suf === "s" && S_END.includes(w[w.length - 2])) w = w.slice(0, -1);
    }
  }
  // Schritt 2
  m = w.match(/(est|en|er|st)$/);
  if (m) {
    const suf = m[1];
    if (inR(suf.length, r1)) {
      if (suf !== "st") w = w.slice(0, -suf.length);
      else if (ST_END.includes(w[w.length - 3]) && w.length - 3 >= 3) w = w.slice(0, -2);
    }
  }
  // Schritt 3
  m = w.match(/(isch|lich|heit|keit|end|ung|ig|ik)$/);
  if (m && inR(m[1].length, r2)) {
    const suf = m[1];
    w = w.slice(0, -suf.length);
    if ((suf === "end" || suf === "ung") && w.endsWith("ig") && inR(2, r2) && w[w.length - 3] !== "e") w = w.slice(0, -2);
    else if ((suf === "ig" || suf === "ik" || suf === "isch") && w.endsWith("e")) w = w + suf; // nicht nach e
    else if ((suf === "lich" || suf === "heit") && /(er|en)$/.test(w) && inR(2, r1)) w = w.slice(0, -2);
    else if (suf === "keit" && /(lich|ig)$/.test(w)) {
      const s2 = w.endsWith("lich") ? 4 : 2;
      if (inR(s2, r2)) w = w.slice(0, -s2);
    }
  }
  w = w.replace(/U/g, "u").replace(/Y/g, "y").replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u");
  stemCache.set(word, w);
  return w;
}

/** Schlüssel für ein Wort oder eine Wortgruppe (Wortformen zusammengeführt). */
export const termKey = (phrase) => phrase.toLowerCase().split(/\s+/).filter(Boolean).map(stemDe).join(" ");

/** Zählt Wörter und (optional) Zweier-Wortgruppen – Wortformen werden zusammengeführt.
 *  counts: Schlüssel -> Anzahl, forms: Schlüssel -> Map(Schreibweise -> Anzahl). */
export function analyzeText(text, useBigrams = true) {
  const counts = new Map();
  const forms = new Map();
  let total = 0;
  const add = (key, surface) => {
    counts.set(key, (counts.get(key) || 0) + 1);
    let f = forms.get(key);
    if (!f) forms.set(key, (f = new Map()));
    f.set(surface, (f.get(surface) || 0) + 1);
  };
  const ok = (w) => w.length > 1 && !STOP.has(w);
  for (const sentence of text.split(/[.!?;:|•·\n]+/)) {
    // Bindestrich-Wörter aufteilen: „Content-Marketing“ = „content marketing“
    const toks = (sentence.toLowerCase().replace(/(\p{L})[-‐–](?=\p{L})/gu, "$1 ").match(WORD) || []).filter((t) => !/^\d+$/.test(t));
    total += toks.length;
    toks.forEach((t, i) => {
      if (ok(t)) add(stemDe(t), t);
      if (useBigrams && i > 0 && ok(t) && ok(toks[i - 1])) add(stemDe(toks[i - 1]) + " " + stemDe(t), toks[i - 1] + " " + t);
    });
  }
  return { counts, forms, total };
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
    const formCount = new Map();
    for (const c of comps) for (const [f, n] of c.forms?.get(t) || []) formCount.set(f, (formCount.get(f) || 0) + n);
    const formsSorted = [...formCount.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f);
    rows.push({ key: t, term: formsSorted[0] || t, forms: formsSorted.slice(0, 5), used, idf: i, avg: avgW * i, max: maxW * i, own: own ? wdf(fOwn, own.total) * i : 0, fOwn, target, maxF, avgCount });
  }
  rows.sort((a, b) => b.avg - a.avg);
  const all = dedupe(rows);
  classifyRows(all, comps, opts.keyword);
  // Wortgruppen leicht bevorzugen: „weihnachten allein verbringen“ sagt mehr als „verbringen“
  const topic = all.filter((r) => !r.generic).sort((a, b) => b.avg * (b.key.includes(" ") ? 1.15 : 1) - a.avg * (a.key.includes(" ") ? 1.15 : 1));
  const generic = all.filter((r) => r.generic).slice(0, 30);
  return [...topic.slice(0, opts.limit), ...generic].map((r) => ({ ...r, status: status(r, !!own) }));
}

// Wenn „content marketing“ fast genauso stark ist wie „content“, beides behalten – aber Einzelwörter,
// die nur als Teil einer Wortgruppe vorkommen (gleiche Häufigkeit), nicht doppelt auflisten.
function dedupe(rows) {
  const bigrams = rows.filter((r) => r.key.includes(" "));
  return rows.filter((r) => {
    if (r.key.includes(" ")) return true;
    return !bigrams.some((b) => b.key.split(" ").includes(r.key) && Math.abs(b.avgCount - r.avgCount) < 0.01 && b.used === r.used);
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

/* ---------- Themenbegriff oder allgemeines Wort? ---------- */
let GEN = null;
const general = () => {
  if (!GEN) {
    GEN = new Map();
    for (const e of GENERAL_PPM.split("|")) {
      const i = e.lastIndexOf(" ");
      GEN.set(e.slice(0, i), Number(e.slice(i + 1)));
    }
  }
  return GEN;
};
// Webseiten-Wörter, die mit dem Thema nichts zu tun haben
const BOILER = "artikel anzeige werbung google newsletter cookie cookies datenschutz impressum kommentar kommentare teilen lesen weiterlesen foto fotos bild bilder quelle abo abonnieren startseite login suche autor autorin redaktion copyright rechte vorbehalten klicken klick link links seite seiten website webseite email e-mail facebook instagram pinterest whatsapp twitter youtube video videos inhaltsverzeichnis ratgeber magazin beitrag beiträge update aktualisiert veröffentlicht stand uhr anzeigen partner affiliate provision erhältlich bevorzugen bevorzugte preis preise rabatt gutschein versand lieferung shop warenkorb bestellen hinweis cookies einstellungen zustimmen akzeptieren"
  .split(" ");
let GENERIC_STEMS = null, BOILER_SET = null;
const BOILER_STEMS = () => BOILER_SET || (BOILER_SET = new Set(BOILER.map((w) => stemDe(w))));
const genericStems = () => GENERIC_STEMS || (GENERIC_STEMS = new Set([...STOPWORDS_ISO.split(" "), ...BOILER].map((w) => stemDe(w.toLowerCase()))));
export const KEYNESS_MIN = 6;

/** Wie viel häufiger kommt ein Wortstamm in den Top-Artikeln vor als in normaler Sprache? */
function keyness(stem, pooled, totalWords) {
  const ppm = ((pooled.get(stem) || 0) / Math.max(1, totalWords)) * 1e6;
  const g = general().get(stem);
  return ppm / (g ?? 1);
}

/** Markiert allgemeine Wörter (z. B. „Zeit“, „bestimmt“) – Keyword-Bestandteile gelten nie als allgemein. */
export function classifyRows(rows, comps, keyword = "") {
  const pooled = new Map();
  let totalWords = 0;
  for (const c of comps) {
    totalWords += c.total;
    for (const [k, n] of c.counts) if (!k.includes(" ")) pooled.set(k, (pooled.get(k) || 0) + n);
  }
  const kwStems = new Set(String(keyword).toLowerCase().split(/[\s-]+/).filter(Boolean).map(stemDe));
  const gs = genericStems();
  for (const r of rows) {
    const parts = r.key.split(" ");
    const partGeneric = (p) => !kwStems.has(p) && (gs.has(p) || keyness(p, pooled, totalWords) < KEYNESS_MIN);
    r.keyness = Math.round(Math.max(...parts.map((p) => keyness(p, pooled, totalWords))) * 10) / 10;
    // Wortgruppen mit Webseiten-Wörtern („google bevorzugen“) sind nie Themenbegriffe
    const boiler = parts.some((p) => BOILER_STEMS().has(p));
    r.generic = boiler || parts.every(partGeneric);
  }
  return rows;
}

/** Gewichteter Abdeckungs-Score 0–100: wichtige Begriffe zählen mehr. */
export function coverageScore(rows) {
  let sum = 0, got = 0;
  for (const r of rows) {
    if (r.generic) continue;
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
