// Umgebungsvariablen lesen – auf Netlify über Netlify.env, lokal über process.env
export const env = (key) => String(globalThis.Netlify?.env?.get(key) ?? process.env[key] ?? "").trim();
