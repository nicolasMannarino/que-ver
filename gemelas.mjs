// Almas gemelas: gente de MovieLens que le puso a tus películas notas parecidas a
// las tuyas. vecinas.mjs compara películas contra películas; esto compara personas,
// y mira qué más puntuaron alto. El panel lo arma armar-gemelas.py.
//
// Medido sobre sus 207 películas de la tabla, dejando cada una afuera: en las 20 que
// pone arriba, la app sola tenía 17 con 7+ y 3 flojas; mitad app y mitad gemelas, 20
// y ninguna. En 268 de 300 remuestreos quedan menos flojas arriba, y en 3 más. Más
// abajo (top 40) empatan: ordena mejor lo mejor, que es donde se elige.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import * as A from "./almacen.mjs";

export const ARCHIVO = path.join(A.DATA, "gemelas.json.gz");
export const CLAVE = "movielens:gemelas:v1";

// Los mismos valores con los que se midió. No se ajustaron a sus notas.
const K = 50;              // cuántas gemelas opinan sobre cada película
const ENCOGER = 50;        // parecido × n/(n+50): 5 películas en común no alcanzan
const MIN_COMUNES = 5;     // con menos en común, no es gemela de nada
const MIN_EN_PANEL = 10;   // con menos películas tuyas en el panel no hay de dónde agarrarse
export const MIN_APOYO = 5;  // para opinar de una candidata, al menos 5 gemelas que la vieron

let panel = null;

const leerB64 = (s, Tipo) => {
  const b = Buffer.from(s, "base64");
  return new Tipo(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

export function usar(doc) {
  if (!doc) { panel = null; return; }
  const inicio = leerB64(doc.inicio, Uint32Array);
  const quien = leerB64(doc.quien, Uint16Array);
  const nota = new Uint8Array(Buffer.from(doc.nota, "base64"));
  const media = leerB64(doc.media, Float32Array);
  if (inicio.length !== doc.tmdb.length + 1 || quien.length !== inicio[doc.tmdb.length]
      || nota.length !== quien.length || media.length !== doc.personas) {
    throw new Error("panel de gemelas roto");
  }
  panel = { inicio, quien, nota, media, personas: doc.personas, hasta: doc.hasta || null,
            fila: new Map(doc.tmdb.map((t, i) => [t, i])) };
}

// Igual que vecinas: primero el archivo de esta compu, si no la base.
export async function cargar() {
  try {
    if (fs.existsSync(ARCHIVO)) {
      usar(JSON.parse(zlib.gunzipSync(fs.readFileSync(ARCHIVO)).toString("utf8")));
      return "archivo";
    }
    const doc = await A.cacheLeer(CLAVE);
    if (doc) { usar(doc); return "base"; }
  } catch (e) {
    console.error("    gemelas: no pude leer el panel (" + e.message + ")");
    panel = null;
  }
  return null;
}

export const info = () => (panel ? { personas: panel.personas, notas: panel.quien.length, hasta: panel.hasta } : null);

// Lo que se aparta la nota de esa persona de su propia media, en estrellas.
const resto = (e) => panel.nota[e] / 2 - panel.media[panel.quien[e]];

// Tus películas en el panel y, para cada persona, cuánto se parece a vos. Se arma
// una vez por perfil: recorre solo a quienes vieron tus películas.
export function perfilDe(vistas, pesoDe = () => 1) {
  if (!panel) return null;
  const mias = vistas.filter(v => v.kind === "movie" && panel.fila.has(v.tmdbId) && pesoDe(v) > 0);
  if (mias.length < MIN_EN_PANEL) return null;
  // Tu escala 1-10 es la de MovieLens (0.5-5 estrellas) por dos.
  const prom = mias.reduce((s, v) => s + v.rating / 2, 0) / mias.length;
  const h = mias.map(v => v.rating / 2 - prom);
  const P = panel.personas;
  const num = new Float64Array(P), nh = new Float64Array(P), nu = new Float64Array(P), n = new Uint16Array(P);
  mias.forEach((v, j) => {
    const f = panel.fila.get(v.tmdbId);
    for (let e = panel.inicio[f]; e < panel.inicio[f + 1]; e++) {
      const u = panel.quien[e], x = resto(e);
      num[u] += x * h[j]; nh[u] += h[j] * h[j]; nu[u] += x * x; n[u]++;
    }
  });
  const sim = new Float32Array(P);
  for (let u = 0; u < P; u++) sim[u] = parecido(num[u], nh[u], nu[u], n[u]);
  return { mias, h, num, nh, nu, n, sim, cache: new Map() };
}

function parecido(num, nh, nu, n) {
  if (n < MIN_COMUNES || nh <= 0 || nu <= 0) return 0;
  return num / Math.sqrt(nh * nu) * n / (n + ENCOGER);
}

// Las K más parecidas entre quienes vieron la fila f, con lo que se apartó cada una.
function predecirFila(f, simDe) {
  const pares = [];
  for (let e = panel.inicio[f]; e < panel.inicio[f + 1]; e++) {
    const s = simDe(e);
    if (s > 0) pares.push([s, e]);
  }
  if (pares.length > K) pares.sort((a, b) => b[0] - a[0]).length = K;
  let num = 0, den = 1;   // el 1 encoge hacia "lo esperable" cuando opinan pocas
  for (const [s, e] of pares) { num += s * resto(e); den += s; }
  return { puntaje: num / den, apoyo: pares.length };
}

export function predecir(pg, tmdbId) {
  if (!pg || !panel) return null;
  if (pg.cache.has(tmdbId)) return pg.cache.get(tmdbId);
  const f = panel.fila.get(tmdbId);
  const out = f === undefined ? null : predecirFila(f, (e) => pg.sim[panel.quien[e]]);
  pg.cache.set(tmdbId, out && out.apoyo >= MIN_APOYO ? out : null);
  return pg.cache.get(tmdbId);
}

// Para calibrar: cada una de las tuyas, con las gemelas buscadas SIN ella.
// Devuelve un Map clave -> puntaje.
export function sinCadaUna(pg) {
  const out = new Map();
  if (!pg) return out;
  pg.mias.forEach((v, j) => {
    const f = panel.fila.get(v.tmdbId), hj = pg.h[j];
    const r = predecirFila(f, (e) => {
      const u = panel.quien[e], x = resto(e);
      return parecido(pg.num[u] - x * hj, pg.nh[u] - hj * hj, pg.nu[u] - x * x, pg.n[u] - 1);
    });
    out.set(v.key, r.puntaje);
  });
  return out;
}

// Para ELEGIR candidatas: una estimación de todas las películas del panel de una
// pasada, con las 3.000 más parecidas en vez de todas. predecir() exacto película por
// película sobre las 12.000 tardaba demasiado; esto recorre el panel una vez. Lo que
// después se muestra se puntúa con predecir(), no con esto.
const GEMELAS_PARA_ELEGIR = 3000;
export function estimada(pg, tmdbId) {
  if (!pg || !panel) return null;
  if (!pg.todas) {
    const positivas = Array.from(pg.sim).filter(s => s > 0).sort((a, b) => b - a);
    const umbral = positivas[Math.min(positivas.length, GEMELAS_PARA_ELEGIR) - 1] ?? Infinity;
    const filas = panel.inicio.length - 1;
    pg.todas = new Float32Array(filas).fill(NaN);
    for (let f = 0; f < filas; f++) {
      const r = predecirFila(f, (e) => { const s = pg.sim[panel.quien[e]]; return s >= umbral ? s : 0; });
      if (r.apoyo >= MIN_APOYO) pg.todas[f] = r.puntaje;
    }
  }
  const f = panel.fila.get(tmdbId);
  return f === undefined || Number.isNaN(pg.todas[f]) ? null : pg.todas[f];
}
