// Einstellungen (Domains, Budget) und Kostenzähler im Netlify-Blob-Speicher.
import { getStore } from "@netlify/blobs";
import { randomUUID } from "node:crypto";

const store = () => getStore({ name: "settings", consistency: "strong" });
const DEFAULTS = { domains: ["kofferfreundin.de"], monthlyBudgetUsd: 10 };

export const cleanDomain = (d) =>
  String(d || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");

export async function getSettings() {
  const s = (await store().get("settings", { type: "json" })) || {};
  return { ...DEFAULTS, ...s };
}

export async function saveSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur };
  if (Array.isArray(patch.domains)) next.domains = [...new Set(patch.domains.map(cleanDomain).filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)))].slice(0, 10);
  if (patch.monthlyBudgetUsd !== undefined) {
    const b = Number(patch.monthlyBudgetUsd);
    if (Number.isFinite(b) && b >= 0 && b <= 500) next.monthlyBudgetUsd = Math.round(b * 100) / 100;
  }
  await store().setJSON("settings", next);
  return next;
}

const month = (d = new Date()) => d.toISOString().slice(0, 7);

/** Verbrauch eines Monats. Jede Abfrage ist ein eigener Eintrag (Betrag steckt im Schlüssel) –
 *  so gehen bei gleichzeitigen Abfragen keine Beträge verloren. */
export async function getUsage(m = month()) {
  const { blobs } = await store().list({ prefix: `usage/${m}/` });
  const u = { totalUsd: 0, calls: 0, byArea: {} };
  for (const b of blobs) {
    const [, , area, cost] = b.key.split("/");
    const v = Number(cost) || 0;
    u.totalUsd += v;
    u.calls += 1;
    u.byArea[area] = (u.byArea[area] || 0) + v;
  }
  const r = (x) => Math.round(x * 100000) / 100000;
  u.totalUsd = r(u.totalUsd);
  for (const k of Object.keys(u.byArea)) u.byArea[k] = r(u.byArea[k]);
  return u;
}

export async function addCost(area, usd) {
  if (!usd) return;
  const safeArea = String(area).replace(/[^a-z0-9-]/gi, "") || "sonstiges";
  await store().set(`usage/${month()}/${safeArea}/${Number(usd).toFixed(6)}/${Date.now()}-${randomUUID().slice(0, 8)}`, "1");
}

export async function budgetLeft() {
  const [s, u] = await Promise.all([getSettings(), getUsage()]);
  return { budget: s.monthlyBudgetUsd, spent: u.totalUsd, left: Math.max(0, s.monthlyBudgetUsd - u.totalUsd) };
}
