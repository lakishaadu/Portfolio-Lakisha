// Lokaler Start:  node server.mjs   ->  http://localhost:8787   (am Mac einfach „Start.command“ doppelklicken)
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchPage } from "./lib/fetch-page.mjs";
import { fetchSerp } from "./lib/serp.mjs";
import { getConfig, setConfig, listProjects, getProject, saveProject, deleteProject } from "./lib/storage.mjs";

const PUBLIC = fileURLToPath(new URL("./public/", import.meta.url));
const port = Number(process.env.PORT) || 8787;
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };

const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

async function readBody(req, limit = 20 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error("Anfrage zu groß");
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const path = u.pathname;
  try {
    // Nur Anfragen von dieser Seite selbst annehmen (Schutz vor fremden Webseiten im Browser)
    if (path.startsWith("/api/") && req.method !== "GET") {
      const origin = req.headers.origin;
      if (origin && origin !== `http://localhost:${port}` && origin !== `http://127.0.0.1:${port}`) return send(res, 403, { error: "Nicht erlaubt" });
    }

    if (path === "/api/fetch") {
      const { status, body } = await fetchPage(u.searchParams.get("url") || "");
      return send(res, status, body);
    }
    if (path === "/api/serp" && req.method === "POST") {
      const { keyword } = await readBody(req);
      if (!keyword?.trim()) return send(res, 400, { error: "Bitte ein Keyword eingeben." });
      const cfg = await getConfig();
      const { status, body } = await fetchSerp(keyword.trim(), { login: cfg.dfsLogin, password: cfg.dfsPassword });
      return send(res, status, body);
    }
    if (path === "/api/config") {
      if (req.method === "POST") {
        const { dfsLogin, dfsPassword } = await readBody(req);
        const patch = {};
        if (typeof dfsLogin === "string") patch.dfsLogin = dfsLogin.trim();
        if (typeof dfsPassword === "string" && dfsPassword) patch.dfsPassword = dfsPassword.trim();
        await setConfig(patch);
      }
      const cfg = await getConfig();
      return send(res, 200, { dfsLogin: cfg.dfsLogin || "", hasPassword: !!cfg.dfsPassword });
    }
    if (path === "/api/projects" && req.method === "GET") return send(res, 200, await listProjects());
    if (path === "/api/projects" && req.method === "POST") return send(res, 200, await saveProject(await readBody(req)));
    const m = path.match(/^\/api\/projects\/([\w-]+)$/);
    if (m && req.method === "GET") {
      const p = await getProject(m[1]);
      return p ? send(res, 200, p) : send(res, 404, { error: "Projekt nicht gefunden" });
    }
    if (m && req.method === "DELETE") return send(res, 200, { ok: await deleteProject(m[1]) });
    if (path.startsWith("/api/")) return send(res, 404, { error: "Unbekannt" });

    const rel = normalize(path === "/" ? "/index.html" : decodeURIComponent(path)).replace(/^(\.\.[/\\])+/, "");
    const data = await readFile(join(PUBLIC, rel));
    res.writeHead(200, { "content-type": types[extname(rel)] || "application/octet-stream" });
    res.end(data);
  } catch (err) {
    if (err.code === "ENOENT") return res.writeHead(404).end("Nicht gefunden");
    send(res, 500, { error: err.message });
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.log(`\nDas Tool läuft bereits (Port ${port}). Öffne http://localhost:${port} im Browser.\n`);
    process.exit(0);
  }
  throw err;
});

// Nur lokal erreichbar – nicht aus dem WLAN
server.listen(port, "127.0.0.1", () => console.log(`\nWDF*IDF-Tool läuft:  http://localhost:${port}\nZum Beenden dieses Fenster schließen (oder Ctrl+C).\n`));
