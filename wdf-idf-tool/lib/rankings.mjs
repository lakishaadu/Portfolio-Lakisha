// Ranking-Tracker: beobachtete Keywords + Positionsverlauf (Netlify Blobs).
import { getStore } from "@netlify/blobs";
import { randomUUID } from "node:crypto";
import { fetchSerp, mapLimit } from "./serp.mjs";
import { cleanDomain } from "./settings.mjs";

const store = () => getStore({ name: "rankings", consistency: "strong" });
export const MAX_TRACKED = 50;
const DEPTH = 30; // Top 30 prüfen

export async function listTracked() {
  return (await store().get("tracked", { type: "json" })) || [];
}
async function saveTracked(list) {
  await store().setJSON("tracked", list);
  return list;
}

export async function addTracked({ keyword, domain }) {
  const kw = String(keyword || "").trim().toLowerCase();
  const d = cleanDomain(domain);
  if (!kw || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) throw new Error("Bitte Keyword und Domain angeben.");
  const list = await listTracked();
  if (list.some((t) => t.keyword === kw && t.domain === d)) return list;
  if (list.length >= MAX_TRACKED) throw new Error(`Maximal ${MAX_TRACKED} Keywords – entferne zuerst ein altes.`);
  list.push({ id: randomUUID(), keyword: kw, domain: d, addedAt: new Date().toISOString(), history: [] });
  return saveTracked(list);
}

export async function removeTracked(id) {
  return saveTracked((await listTracked()).filter((t) => t.id !== id));
}

async function checkOne(t) {
  const serp = await fetchSerp(t.keyword, { depth: DEPTH, ownDomains: [t.domain], area: "rankings", resolveAll: false });
  const top3 = serp.results.slice(0, 3).map((r) => r.domain);
  const own = serp.insights.ownPosition;
  return {
    date: new Date().toISOString(),
    position: own ? own.rank : null,
    url: own ? own.url : null,
    top3,
    aiOverview: serp.insights.aiOverview.present,
    aiCited: serp.insights.aiOverview.ownCited,
  };
}

/** Prüft die Positionen (alle oder ausgewählte IDs). Zeitbudget, damit Netlify-Grenzen eingehalten werden. */
export async function checkRankings(ids = null, { deadlineMs = 25000 } = {}) {
  const start = Date.now();
  const list = await listTracked();
  const todo = list.filter((t) => !ids || ids.includes(t.id));
  const errors = [];
  let cost = 0;
  await mapLimit(todo, 8, async (t) => {
    if (Date.now() - start > deadlineMs) return;
    try {
      const entry = await checkOne(t);
      t.history = [...(t.history || []), entry].slice(-104); // max. 2 Jahre wöchentlich
      t.lastChecked = entry.date;
    } catch (err) {
      errors.push(`${t.keyword}: ${err.message}`);
      if (err.status === 402) throw err; // Budget erreicht → abbrechen
    }
  }).catch((err) => errors.push(err.message));
  await saveTracked(list);
  return { checked: todo.filter((t) => t.lastChecked && Date.parse(t.lastChecked) >= start).length, total: todo.length, errors, list };
}
