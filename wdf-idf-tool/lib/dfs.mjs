// Gemeinsamer DataForSEO-Anschluss: Zugang, Budget-Schutz, Kostenzähler, verständliche Fehler.
import { env } from "./env.mjs";
import { addCost, budgetLeft } from "./settings.mjs";

export class DfsError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

export const dfsConfigured = () => !!(env("DFS_LOGIN") && env("DFS_PASSWORD"));
const BASE = () => env("DFS_BASE") || "https://api.dataforseo.com"; // DFS_BASE nur für Tests

/**
 * Schickt einen Live-Task an DataForSEO und liefert result[0].
 * area: Bereich für die Kostenübersicht ("analyse", "rankings", ...). minLeftUsd: nötiges Restbudget.
 */
export async function dfsLive(path, task, { area = "sonstiges", minLeftUsd = 0.01, timeoutMs = 40000 } = {}) {
  const login = env("DFS_LOGIN"), password = env("DFS_PASSWORD");
  if (!login || !password) throw new DfsError("Keine DataForSEO-Zugangsdaten hinterlegt (DFS_LOGIN und DFS_PASSWORD in Netlify).", 400);
  const b = await budgetLeft();
  if (b.left < minLeftUsd) {
    throw new DfsError(`Monatsbudget erreicht (${b.spent.toFixed(2)} $ von ${b.budget.toFixed(2)} $). Unter „Einstellungen“ kannst du es erhöhen.`, 402);
  }
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  let res, data;
  try {
    res = await fetch(BASE() + path, {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: "Basic " + Buffer.from(`${login}:${password}`).toString("base64"), "Content-Type": "application/json" },
      body: JSON.stringify([task]),
    });
    data = await res.json();
  } catch (err) {
    throw new DfsError(err.name === "AbortError" ? "DataForSEO antwortet zu langsam. Bitte gleich noch einmal versuchen." : `DataForSEO nicht erreichbar: ${err.message}`);
  } finally {
    clearTimeout(t);
  }
  const cost = Number(data?.cost ?? data?.tasks?.[0]?.cost ?? 0);
  if (cost) await addCost(area, cost).catch(() => {});
  if (res.status === 401 || data?.status_code === 40100) throw new DfsError("DataForSEO lehnt die Zugangsdaten ab. Bitte DFS_LOGIN und das API-Passwort prüfen.");
  const task0 = data?.tasks?.[0];
  if (!task0 || task0.status_code !== 20000) {
    const msg = task0?.status_message || data?.status_message || "Unbekannter Fehler";
    const hint = /balance|fund|payment|money/i.test(msg) ? " – vermutlich ist dein DataForSEO-Guthaben aufgebraucht." : "";
    throw new DfsError(`DataForSEO: ${msg}${hint}`);
  }
  return { result: task0.result?.[0] || null, cost };
}
