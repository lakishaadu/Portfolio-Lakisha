// Lokaler Start ohne Installation:  node server.mjs   ->  http://localhost:8787
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchPage } from "./netlify/functions/fetch-page.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT) || 8787;
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };

http
  .createServer(async (req, res) => {
    const u = new URL(req.url, `http://${req.headers.host}`);
    if (u.pathname === "/api/fetch") {
      const { status, body } = await fetchPage(u.searchParams.get("url") || "");
      res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify(body));
    }
    const rel = normalize(u.pathname === "/" ? "/index.html" : u.pathname).replace(/^(\.\.[/\\])+/, "");
    try {
      const data = await readFile(join(root, rel));
      res.writeHead(200, { "content-type": types[extname(rel)] || "application/octet-stream" });
      res.end(data);
    } catch {
      res.writeHead(404).end("Nicht gefunden");
    }
  })
  .listen(port, () => console.log(`WDF*IDF-Tool läuft auf http://localhost:${port}`));
