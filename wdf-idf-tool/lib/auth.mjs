// Zugangsschutz: Passwort-Login (Cookie) für den Browser, Bot-Schlüssel für Bots.
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env.mjs";

const COOKIE = "wdf_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 Tage

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};
// Schlüssel hängt am Passwort: Passwort ändern = alle alten Logins ungültig
const sign = (payload) => createHmac("sha256", "wdf-session:" + env("APP_PASSWORD")).update(payload).digest("base64url");

export function checkPassword(pw) {
  const expected = env("APP_PASSWORD");
  return !!expected && safeEqual(pw || "", expected);
}

export function sessionCookie(secure = true) {
  const exp = String(Date.now() + MAX_AGE * 1000);
  return `${COOKIE}=${exp}.${sign(exp)}; Path=/; HttpOnly;${secure ? " Secure;" : ""} SameSite=Lax; Max-Age=${MAX_AGE}`;
}
export const clearCookie = (secure = true) => `${COOKIE}=; Path=/; HttpOnly;${secure ? " Secure;" : ""} SameSite=Lax; Max-Age=0`;

/** Liefert "browser", "bot" oder null (nicht angemeldet). */
export function whoIs(req) {
  const key = env("BOT_API_KEY");
  const auth = req.headers.get("authorization") || "";
  const given = auth.replace(/^Bearer\s+/i, "").trim() || (req.headers.get("x-api-key") || "").trim();
  if (key && given && safeEqual(given, key)) return "bot";
  if (!env("APP_PASSWORD")) return null;
  const m = (req.headers.get("cookie") || "").match(new RegExp(`${COOKIE}=(\\d+)\\.([\\w-]+)`));
  if (m && Number(m[1]) > Date.now() && safeEqual(m[2], sign(m[1]))) return "browser";
  return null;
}

/** Geheimes Token für interne Aufrufe (Zeitplan → Hintergrund-Funktion). */
export const internalToken = () => createHmac("sha256", "wdf-internal:" + (env("APP_PASSWORD") || env("BOT_API_KEY"))).update("rank-check").digest("base64url");
export const isInternal = (req) => {
  const t = req.headers.get("x-internal-token") || "";
  return !!(env("APP_PASSWORD") || env("BOT_API_KEY")) && safeEqual(t, internalToken());
};
