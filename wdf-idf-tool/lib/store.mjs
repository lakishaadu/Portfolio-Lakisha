// Projekte im Netlify-Blob-Speicher (privat, nur über die eigene, geschützte API erreichbar).
import { getStore } from "@netlify/blobs";
import { randomUUID } from "node:crypto";

const projects = () => getStore({ name: "projects", consistency: "strong" });
const safeId = (id) => (/^[a-z0-9-]{8,64}$/i.test(id || "") ? id : null);

export async function listProjects() {
  const store = projects();
  const { blobs } = await store.list();
  const metas = await Promise.all(blobs.map((b) => store.getMetadata(b.key)));
  return metas
    .map((m, i) => m && { id: blobs[i].key, ...m.metadata })
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function getProject(id) {
  if (!safeId(id)) return null;
  return projects().get(id, { type: "json" });
}

export async function saveProject(project) {
  const now = new Date().toISOString();
  const id = safeId(project.id) || randomUUID();
  const existing = (await getProject(id)) || {};
  const merged = { ...existing, ...project, id, createdAt: existing.createdAt || now, updatedAt: now };
  const last = (merged.history || []).at(-1);
  await projects().setJSON(id, merged, {
    metadata: { keyword: merged.keyword, source: merged.source || "web", createdAt: merged.createdAt, updatedAt: now, score: last?.score ?? null },
  });
  return merged;
}

export async function deleteProject(id) {
  if (!safeId(id)) return false;
  await projects().delete(id);
  return true;
}
