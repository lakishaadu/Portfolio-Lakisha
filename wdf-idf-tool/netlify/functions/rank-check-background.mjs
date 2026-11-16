// Hintergrund-Funktion (bis 15 Min.): prüft die Google-Positionen aller beobachteten Keywords.
import { isInternal, whoIs } from "../../lib/auth.mjs";
import { checkRankings } from "../../lib/rankings.mjs";

export default async (req) => {
  if (!isInternal(req) && !whoIs(req)) return; // Antwort wird bei Hintergrund-Funktionen ohnehin verworfen
  let ids = null;
  try {
    const body = await req.json();
    if (Array.isArray(body?.ids) && body.ids.length) ids = body.ids;
  } catch {}
  const r = await checkRankings(ids, { deadlineMs: 13 * 60 * 1000 });
  console.log(`Ranking-Prüfung: ${r.checked}/${r.total} geprüft`, r.errors.length ? r.errors : "");
};

export const config = { background: true, path: "/api/internal/rank-check" };
