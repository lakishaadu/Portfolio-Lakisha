// Speichert Einstellungen und Projekte als JSON-Dateien im Ordner „daten“ – nur auf deinem Rechner.
import { mkdir, readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

export const DATA_DIR = fileURLToPath(new URL("../daten/", import.meta.url));
const PROJECT_DIR = join(DATA_DIR, "projekte");
const CONFIG_FILE = join(DATA_DIR, "einstellungen.json");

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

export async function getConfig() {
  return readJson(CONFIG_FILE, {});
}

export async function setConfig(patch) {
  await mkdir(DATA_DIR, { recursive: true });
  const cfg = { ...(await getConfig()), ...patch };
  await writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  return cfg;
}

const safeId = (id) => (/^[a-z0-9-]{8,64}$/i.test(id) ? id : null);

export async function listProjects() {
  await mkdir(PROJECT_DIR, { recursive: true });
  const files = (await readdir(PROJECT_DIR)).filter((f) => f.endsWith(".json"));
  const items = await Promise.all(files.map((f) => readJson(join(PROJECT_DIR, f), null)));
  return items
    .filter(Boolean)
    .map((p) => ({ id: p.id, keyword: p.keyword, createdAt: p.createdAt, updatedAt: p.updatedAt, history: p.history || [] }))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function getProject(id) {
  if (!safeId(id)) return null;
  return readJson(join(PROJECT_DIR, `${id}.json`), null);
}

export async function saveProject(project) {
  await mkdir(PROJECT_DIR, { recursive: true });
  const now = new Date().toISOString();
  const id = safeId(project.id || "") || randomUUID();
  const existing = (await getProject(id)) || {};
  const merged = { ...existing, ...project, id, createdAt: existing.createdAt || now, updatedAt: now };
  await writeFile(join(PROJECT_DIR, `${id}.json`), JSON.stringify(merged));
  return merged;
}

export async function deleteProject(id) {
  if (!safeId(id)) return false;
  try {
    await unlink(join(PROJECT_DIR, `${id}.json`));
    return true;
  } catch {
    return false;
  }
}
