// Zeitplan: jeden Montag 05:00 UTC (= 06:00 Uhr deutscher Winterzeit, 07:00 Uhr Sommerzeit)
// stößt die Hintergrund-Funktion an, die alle Rankings prüft.
import { internalToken } from "../../lib/auth.mjs";
import { env } from "../../lib/env.mjs";

export default async () => {
  const base = env("URL");
  const res = await fetch(`${base}/api/internal/rank-check`, { method: "POST", headers: { "x-internal-token": internalToken(), "content-type": "application/json" }, body: "{}" });
  console.log(`Ranking-Prüfung angestoßen: HTTP ${res.status}`);
};

export const config = { schedule: "0 5 * * 1" };
