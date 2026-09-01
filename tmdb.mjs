// Cliente de TMDB con cache en disco. Sin dependencias: Node 22 ya trae fetch.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

const CACHE_DIR = path.join(import.meta.dirname, "data", "cache");
const BASE = "https://api.themoviedb.org/3";

let apiKey = null;
let requests = 0;

// La key global es la del modo local (una sola persona, una sola key). Cuando
// la app está publicada cada cuenta trae la suya, y una variable de módulo se
// vuelve una carrera: dos requests en paralelo se pisan la key y uno termina
// pegándole a TMDB con la del otro. El contexto async le da a cada request la
// suya sin que motor.mjs se entere de que esto existe.
const contexto = new AsyncLocalStorage();
export const conKey = (k, fn) => (k ? contexto.run({ key: String(k).trim() }, fn) : fn());
const keyActual = () => contexto.getStore()?.key || apiKey;

export function setKey(k) { apiKey = (k || "").trim(); }
export function stats() { return { requests }; }

function cachePath(key) {
  // El nombre lleva un hash del pedido COMPLETO. Truncar el texto no alcanzaba:
  // las URLs de /discover son largas y todas terminaban en el mismo archivo,
  // así que una consulta devolvía el resultado cacheado de otra.
  const hash = crypto.createHash("sha1").update(key).digest("hex").slice(0, 16);
  const legible = key.replace(/[^a-z0-9]+/gi, "_").slice(0, 70);
  return path.join(CACHE_DIR, legible + "_" + hash + ".json");
}

function readCache(key, maxAgeMs) {
  try {
    const p = cachePath(key);
    const st = fs.statSync(p);
    if (maxAgeMs && Date.now() - st.mtimeMs > maxAgeMs) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch { return null; }
}

function writeCache(key, value) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachePath(key), JSON.stringify(value));
  } catch { /* el cache es best-effort */ }
}

// Una semana para detalles, un dia para listas que cambian seguido
export async function tmdb(endpoint, params = {}, { ttl = 7 * 24 * 3600e3 } = {}) {
  const laKey = keyActual();
  if (!laKey) throw new Error("NO_KEY");
  // es-MX y no es-ES: devuelve los títulos latinos, que son los que él usa
  // ("Buenos Muchachos" y no "Uno de los nuestros"). Además hace que los
  // títulos de su lista matcheen exacto en la búsqueda.
  const qs = new URLSearchParams({ language: "es-MX", ...params });
  const key = endpoint + "?" + qs.toString();
  const hit = readCache(key, ttl);
  if (hit) return hit;

  const headers = { accept: "application/json" };
  let url = BASE + endpoint + "?" + qs.toString();
  if (laKey.startsWith("ey")) headers.authorization = "Bearer " + laKey; // token v4
  else url += "&api_key=" + encodeURIComponent(laKey);                   // key v3

  requests++;
  const res = await fetch(url, { headers });
  if (res.status === 429) {                    // TMDB pide bajar el ritmo
    await new Promise(r => setTimeout(r, 1500));
    requests--;
    return tmdb(endpoint, params, { ttl });
  }
  if (!res.ok) {
    if (res.status === 401) throw new Error("BAD_KEY");
    if (res.status === 404) return null;
    throw new Error("TMDB_" + res.status);
  }
  const json = await res.json();
  writeCache(key, json);
  return json;
}

// Corre tareas con concurrencia limitada, para no atropellar la API
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); }
      catch { out[idx] = null; }
    }
  });
  await Promise.all(workers);
  return out;
}

export const findByImdb = (tt) => tmdb(`/find/${tt}`, { external_source: "imdb_id" });
export const details = (kind, id) =>
  tmdb(`/${kind}/${id}`, { append_to_response: "keywords,credits" });
export const recommendations = (kind, id) => tmdb(`/${kind}/${id}/recommendations`, {}, { ttl: 30 * 24 * 3600e3 });
export const similar = (kind, id) => tmdb(`/${kind}/${id}/similar`, {}, { ttl: 30 * 24 * 3600e3 });
export const providers = (kind, id) => tmdb(`/${kind}/${id}/watch/providers`, {}, { ttl: 3 * 24 * 3600e3 });
export const searchMulti = (query, year) =>
  tmdb("/search/multi", year ? { query, year } : { query });
export const coleccion = (id) => tmdb(`/collection/${id}`, {}, { ttl: 30 * 24 * 3600e3 });

export const descubrir = (kind, params) =>
  tmdb(`/discover/${kind}`, params, { ttl: 7 * 24 * 3600e3 });
export const persona = (id) => tmdb(`/person/${id}`, {}, { ttl: 60 * 24 * 3600e3 });
export const creditosPersona = (id) =>
  tmdb(`/person/${id}/movie_credits`, {}, { ttl: 30 * 24 * 3600e3 });
