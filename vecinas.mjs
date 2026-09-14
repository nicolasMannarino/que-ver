// Gente que puntúa como vos. La tabla la arma armar-vecinas.py con MovieLens: para
// cada par de películas conocidas, cuánto se parecen las notas que les puso la gente
// que vio las dos. Acá se usa: con las películas que puntuaste se predice cuánto te
// va a gustar otra, mirando a cuáles de las tuyas se parece EN LO QUE LA GENTE SIENTE,
// no en quién la dirigió. Ver README, «Gente que puntúa como vos».
//
// No es una opinión sobre actores ni directores: una película de Muccino que la gente
// que amó En busca de la felicidad no amó, acá no se parece a En busca de la felicidad.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import * as A from "./almacen.mjs";

export const ARCHIVO = path.join(A.DATA, "vecinas.json.gz");
export const CLAVE = "movielens:vecinas:v1";

// Los mismos valores con los que se midió (README). No se ajustaron a sus notas.
const K = 30;              // cuántas de las tuyas, las más parecidas, opinan sobre cada una
const LAM_PERSONA = 10;    // encogimiento de tu sesgo: con pocas notas no se sabe si sos generoso
const MIN_EN_TABLA = 5;    // con menos películas tuyas en la tabla no hay de dónde agarrarse
const MIN_APOYO = 3;       // para PROPONER una, que se parezca al menos a 3 de las tuyas

let tabla = null;

// Cargar desde un documento ya parseado. Separado para que test.mjs pruebe con una
// tabla de mentira, sin archivo ni base.
export function usar(doc) {
  if (!doc) { tabla = null; return; }
  const n = doc.tmdb.length;
  const tri = new Uint8Array(Buffer.from(doc.triangulo, "base64"));
  if (tri.length !== n * (n - 1) / 2) throw new Error(`tabla de vecinas rota: ${tri.length} similitudes para ${n} películas`);
  tabla = {
    n, tri, mu: doc.mu, hasta: doc.hasta || null,
    tmdb: Int32Array.from(doc.tmdb),
    sesgo: Float32Array.from(doc.sesgo),
    fila: new Map(doc.tmdb.map((t, i) => [t, i])),
    // Año y animación (0 no · 1 sí · 2 anime), para no proponer lo que sus reglas
    // van a bajar igual. Opcionales: una tabla vieja sin ellos sigue sirviendo.
    anio: doc.anio ? Int16Array.from(doc.anio) : null,
    animacion: doc.animacion ? Uint8Array.from(doc.animacion) : null,
  };
}

// Primero el archivo de esta compu; si no está, la base (así la ve la app publicada,
// que no tiene data/ propio). Si no hay tabla en ningún lado, la app anda igual que
// antes: solo con el motor.
export async function cargar() {
  try {
    if (fs.existsSync(ARCHIVO)) {
      usar(JSON.parse(zlib.gunzipSync(fs.readFileSync(ARCHIVO)).toString("utf8")));
      return "archivo";
    }
    const doc = await A.cacheLeer(CLAVE);
    if (doc) { usar(doc); return "base"; }
  } catch (e) {
    console.error("    vecinas: no pude leer la tabla (" + e.message + ")");
    tabla = null;
  }
  return null;
}

export const disponible = () => !!tabla;
export const info = () => (tabla ? { peliculas: tabla.n, hasta: tabla.hasta } : null);
export const enTabla = (tmdbId) => !!tabla?.fila.has(tmdbId);
// Cuánto se parecen dos películas, por id de TMDB (0 a 1). Para test.mjs y para mirar a mano.
export const similitud = (a, b) =>
  tabla?.fila.has(a) && tabla.fila.has(b) ? sim(tabla.fila.get(a), tabla.fila.get(b)) : null;

// Similitud entre dos filas. Es simétrica y se guarda el triángulo de arriba fila por
// fila (i < j), igual que np.triu_indices: la fila i arranca en i·n − i(i+1)/2.
function sim(i, j) {
  if (i === j) return 0;
  if (i > j) { const t = i; i = j; j = t; }
  return tabla.tri[i * tabla.n - (i * (i + 1)) / 2 + (j - i - 1)] / 255;
}

// Tus películas que están en la tabla, con cuánto se aparta tu nota de lo esperable
// para esa película. `pesoDe` es el mismo del motor: «no tener en cuenta» no opina y
// «de chico» opina un tercio. Sin eso recomendaba Pixar: la gente que ama Toy Story
// ama Up, y eso es cierto y no te sirve.
export function perfilDe(vistas, pesoDe = () => 1) {
  if (!tabla) return null;
  const fila = [], peso = [], resto = [], titulo = [], clave = [];
  for (const v of vistas) {
    if (v.kind !== "movie") continue;
    const i = tabla.fila.get(v.tmdbId);
    if (i === undefined) continue;
    const w = pesoDe(v);
    if (!(w > 0)) continue;
    fila.push(i); peso.push(w); clave.push(v.key);
    // Tu escala 1-10 es la de MovieLens (0.5-5 estrellas) por dos.
    resto.push(v.rating / 2 - tabla.mu - tabla.sesgo[i]);
    titulo.push(v.titulo || v.d?.title || v.title || null);
  }
  if (fila.length < MIN_EN_TABLA) return null;
  let SW = 0, SWD = 0;
  for (let k = 0; k < fila.length; k++) { SW += peso[k]; SWD += peso[k] * resto[k]; }
  return { fila, peso, resto, titulo, clave, SW, SWD, cache: new Map() };
}

// Cuánto se aparta ESTA película de lo esperable para vos, según tus K más parecidas.
// `sin` deja afuera una de las tuyas —la que se está prediciendo—, también de tu sesgo.
function calcular(pv, c, sin = -1) {
  const bu = sin >= 0
    ? (pv.SWD - pv.peso[sin] * pv.resto[sin]) / (pv.SW - pv.peso[sin] + LAM_PERSONA)
    : pv.SWD / (pv.SW + LAM_PERSONA);
  const pares = [];
  for (let k = 0; k < pv.fila.length; k++) {
    if (k === sin) continue;
    const s = sim(c, pv.fila[k]) * pv.peso[k];
    if (s > 0) pares.push([s, k]);
  }
  pares.sort((a, b) => b[0] - a[0]);
  const top = pares.slice(0, K);
  let num = 0, den = 0;
  for (const [s, k] of top) { num += s * (pv.resto[k] - bu); den += s; }
  const resid = den ? num / den : 0;
  return { bu, resid, top };
}

// Lo que el motor mezcla (`puntaje`) y lo que se le puede decir a él (`nota`, en su
// escala). El puntaje no lleva tu sesgo: es igual para todas las candidatas y, en el
// dejar-una-afuera, cambiaría con la nota de la que se está prediciendo.
function armar(pv, c, r) {
  const porQue = r.top
    .filter(([, k]) => pv.resto[k] - r.bu > 0 && pv.titulo[k])
    .sort((a, b) => b[0] * (pv.resto[b[1]] - r.bu) - a[0] * (pv.resto[a[1]] - r.bu))
    .slice(0, 2).map(([, k]) => pv.titulo[k]);
  return {
    puntaje: tabla.sesgo[c] + r.resid,
    nota: Math.min(10, Math.max(1, 2 * (tabla.mu + r.bu + tabla.sesgo[c] + r.resid))),
    apoyo: r.top.length,
    porQue,
  };
}

export function predecir(pv, tmdbId) {
  if (!pv || !tabla) return null;
  if (pv.cache.has(tmdbId)) return pv.cache.get(tmdbId);
  const c = tabla.fila.get(tmdbId);
  const out = c === undefined ? null : armar(pv, c, calcular(pv, c));
  pv.cache.set(tmdbId, out);
  return out;
}

// Para calibrar: la predicción de cada una de tus películas SIN su propia nota.
// Devuelve un Map clave -> puntaje.
export function sinCadaUna(pv) {
  const out = new Map();
  if (!pv) return out;
  for (let k = 0; k < pv.fila.length; k++) out.set(pv.clave[k], armar(pv, pv.fila[k], calcular(pv, pv.fila[k], k)).puntaje);
  return out;
}

// Las que más te recomendaría la gente como vos, para sumarlas como candidatas. El
// resto de las fuentes sale de TMDB («recommendations», keywords, catálogo) y trae
// siempre el mismo vecindario; esta trae lo que la gente con tu gusto puntuó alto.
// Solo las que se parecen a varias de las tuyas: sin apoyo, la predicción es la fama
// de la película y nada más, y eso ya lo trae el catálogo.
// `filtro({ anio, animacion })`: sin él proponía Mulán, El mago de Oz y Mary Poppins
// —la gente que ama Shrek 2 las ama—, que después sus reglas bajaban igual, y en el
// camino ocupaban los lugares de las que sí servían.
//
// El orden de las 4.400 se calcula una vez por perfil y queda guardado: una búsqueda
// pide esto en cada ronda, y en la CPU de Render recorrer la tabla entera cada vez
// se nota. Puntuar algo arma un perfil nuevo, y con él un orden nuevo.
export function mejores(pv, { excluir = new Set(), n = 30, filtro = null } = {}) {
  if (!pv || !tabla) return [];
  if (!pv.orden) {
    const mias = new Set(pv.fila);
    const lista = [];
    for (let c = 0; c < tabla.n; c++) {
      if (mias.has(c)) continue;
      const p = predecir(pv, tabla.tmdb[c]);
      if (p && p.apoyo >= MIN_APOYO) lista.push({ c, tmdbId: tabla.tmdb[c], ...p });
    }
    pv.orden = lista.sort((a, b) => b.puntaje - a.puntaje);
  }
  const salida = [];
  for (const { c, ...x } of pv.orden) {
    if (excluir.has("movie:" + x.tmdbId)) continue;
    if (filtro && !filtro({ anio: tabla.anio?.[c] || null, animacion: tabla.animacion?.[c] ?? null })) continue;
    salida.push(x);
    if (salida.length >= n) break;
  }
  return salida;
}
