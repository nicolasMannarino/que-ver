// Dónde viven los datos. Dos backends con la MISMA interfaz sincrona, para que
// el resto del código no se entere de cuál está corriendo:
//
//   disco     — archivos JSON en data/, como siempre. Es el de tu compu.
//   postgres  — para el hosting: allá el disco se borra en cada reinicio, así
//               que un archivo no es un lugar donde guardar nada.
//
// El de postgres carga TODO a memoria al arrancar y escribe de fondo. Puede
// permitirse eso porque Render corre una sola instancia: no hay un segundo
// proceso que le pise los datos por atrás. Si algún día hay más de una, esto
// deja de valer y hay que leer de la base en cada request.
//
// La clave es la ruta relativa de siempre ("usuarios/nico/puntuaciones.json").
// Mantenerla igual es lo que evitó reescribir datos.mjs y server.mjs enteros.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const DIR = import.meta.dirname;
export const DATA = path.join(DIR, "data");

let modo = "disco";
let memoria = new Map();      // clave -> valor ya parseado
let pool = null;
let pendientes = Promise.resolve();
let fallosDeEscritura = 0;

export const backend = () => modo;

// --- Arranque ---------------------------------------------------------------

// Neon entrega la cadena terminada en "?sslmode=require&channel_binding=require".
// node-postgres HOY trata ese "require" como verify-full —verifica el certificado
// de verdad, y contra Neon anda— pero avisa en cada arranque que en su próxima
// versión mayor va a pasar a significar lo contrario: cifrar sin verificar. Lo
// dejamos escrito como verify-full, que es lo que ya está pasando: así no se
// debilita solo el día que la dependencia suba de major, y de paso no ensucia
// los logs. channel_binding sale porque pg no lo implementa.
function conSslExplicito(url) {
  try {
    const u = new URL(url);
    u.searchParams.delete("channel_binding");
    u.searchParams.set("sslmode",
      process.env.DATABASE_SSL_SIN_VERIFICAR === "1" ? "no-verify" : "verify-full");
    return u.toString();
  } catch { return url; }   // cadena rara: que decida pg
}

export async function abrir() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    modo = "disco";
    fs.mkdirSync(DATA, { recursive: true });
    return modo;
  }

  // pg se importa acá adentro a propósito: si no hay DATABASE_URL, el proyecto
  // sigue corriendo sin la dependencia instalada.
  const { default: pg } = await import("pg");
  pool = new pg.Pool({ connectionString: conSslExplicito(url), max: 4 });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS archivos (
      clave       TEXT PRIMARY KEY,
      valor       JSONB NOT NULL,
      actualizado TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // El cache de TMDB va en su propia tabla y NO se carga a memoria. Son decenas
  // de miles de fichas: traerlas todas en cada arranque costaria mas de lo que
  // ahorra, y el limite de transferencia de Neon es de 5 GB por mes. Se leen de
  // a una, cuando hacen falta.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cache_tmdb (
      clave       TEXT PRIMARY KEY,
      valor       BYTEA NOT NULL,
      actualizado TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await pool.query("SELECT clave, valor FROM archivos");
  memoria = new Map(rows.map(r => [r.clave, r.valor]));
  modo = "postgres";
  return modo;
}

// --- Cache de TMDB que sobrevive los reinicios --------------------------------
// El disco de Render se borra cada vez que la instancia se despierta, y armar
// una busqueda con el cache vacio son ~120 pedidos a TMDB: 34 segundos medidos
// contra 0,8 con el cache lleno. Esto lo hace persistente.
//
// Comprimido: una ficha con creditos y keywords pesa ~100 KB en JSON y ~10 KB
// gzipeada. Multiplicado por miles de titulos, es la diferencia entre entrar o
// no entrar en el medio giga del plan gratis.

export async function cacheLeer(clave) {
  if (modo !== "postgres") return null;
  try {
    const { rows } = await pool.query(
      "SELECT valor FROM cache_tmdb WHERE clave = $1", [clave]);
    if (!rows.length) return null;
    return JSON.parse(zlib.gunzipSync(rows[0].valor).toString("utf8"));
  } catch { return null; }        // el cache es best-effort, nunca rompe la app
}

// De a muchas y en UNA consulta. Armar el perfil son 284 fichas: pedirlas una
// por una son 284 idas y vueltas a la base, y aunque cada una tarde poco, la
// suma se nota. Asi es un solo viaje.
export async function cacheLeerVarias(claves) {
  const salida = new Map();
  if (modo !== "postgres" || !claves.length) return salida;
  try {
    const { rows } = await pool.query(
      "SELECT clave, valor FROM cache_tmdb WHERE clave = ANY($1)", [claves]);
    for (const r of rows) {
      try { salida.set(r.clave, JSON.parse(zlib.gunzipSync(r.valor).toString("utf8"))); }
      catch { /* una fila corrupta no tira las demas */ }
    }
  } catch { /* best-effort */ }
  return salida;
}

export function cacheEscribir(clave, valor) {
  if (modo !== "postgres") return;
  let comprimido;
  try { comprimido = zlib.gzipSync(Buffer.from(JSON.stringify(valor), "utf8")); }
  catch { return; }
  // Fuera de la cola de escritura de los datos: que guardar una ficha de TMDB
  // no demore el guardado de una puntuacion tuya.
  pool.query(
    "INSERT INTO cache_tmdb (clave, valor, actualizado) VALUES ($1, $2, now()) " +
    "ON CONFLICT (clave) DO UPDATE SET valor = $2, actualizado = now()",
    [clave, comprimido],
  ).catch(() => { /* best-effort */ });
}

// Para el banco de pruebas: una ida y vuelta a la base, sin traer nada.
export async function pingBase() {
  if (modo !== "postgres") return null;
  await pool.query("SELECT 1");
}

// Unas claves cualesquiera, para medir cuánto tarda leer de a muchas.
export async function cacheAlgunasClaves(n = 100) {
  if (modo !== "postgres") return [];
  const { rows } = await pool.query("SELECT clave FROM cache_tmdb LIMIT $1", [n]);
  return rows.map(r => r.clave);
}

export async function cacheTamanio() {
  if (modo !== "postgres") return null;
  const { rows } = await pool.query(
    "SELECT count(*)::int AS n, coalesce(sum(length(valor)),0)::bigint AS bytes FROM cache_tmdb");
  return { n: rows[0].n, mb: Number(rows[0].bytes) / 1e6 };
}

// Vuelve a leer todo de la base. Hace falta cuando alguien escribió por afuera
// —el script de migración, una consulta a mano— porque la memoria de este
// proceso quedó vieja y no tiene forma de enterarse sola.
export async function recargar() {
  if (modo !== "postgres") return 0;
  await drenar();                       // primero que baje lo que está en vuelo
  const { rows } = await pool.query("SELECT clave, valor FROM archivos");
  memoria = new Map(rows.map(r => [r.clave, r.valor]));
  return memoria.size;
}

// --- Lectura y escritura ----------------------------------------------------

const rutaDe = (clave) => path.join(DATA, clave);

export function leer(clave, def) {
  if (modo === "postgres") {
    return memoria.has(clave) ? memoria.get(clave) : def;
  }
  try { return JSON.parse(fs.readFileSync(rutaDe(clave), "utf8")); }
  catch { return def; }
}

export function escribir(clave, valor) {
  if (modo === "postgres") {
    memoria.set(clave, valor);
    encolar(
      "INSERT INTO archivos (clave, valor, actualizado) VALUES ($1, $2, now()) " +
      "ON CONFLICT (clave) DO UPDATE SET valor = $2, actualizado = now()",
      [clave, JSON.stringify(valor)],
    );
    return valor;
  }
  const f = rutaDe(clave);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(valor, null, 2));
  return valor;
}

export function borrar(clave) {
  if (modo === "postgres") {
    memoria.delete(clave);
    encolar("DELETE FROM archivos WHERE clave = $1", [clave]);
    return;
  }
  try { fs.rmSync(rutaDe(clave), { force: true }); } catch { /* ya no estaba */ }
}

// Borrar "usuarios/nico/" se lleva las puntuaciones, el estado, todo.
export function borrarPrefijo(prefijo) {
  if (modo === "postgres") {
    for (const k of [...memoria.keys()]) if (k.startsWith(prefijo)) memoria.delete(k);
    encolar("DELETE FROM archivos WHERE clave LIKE $1", [prefijo.replace(/[%_]/g, "\\$&") + "%"]);
    return;
  }
  try { fs.rmSync(rutaDe(prefijo), { recursive: true, force: true }); } catch { /* ya no estaba */ }
}

export function existe(clave) {
  if (modo === "postgres") return memoria.has(clave);
  return fs.existsSync(rutaDe(clave));
}

// Las claves que arrancan con un prefijo. En disco no hace falta todavía, pero
// la interfaz tiene que ser la misma en los dos lados o el que la use se rompe
// solo cuando lo subís.
export function claves(prefijo = "") {
  if (modo === "postgres") return [...memoria.keys()].filter(k => k.startsWith(prefijo));
  const base = rutaDe(prefijo);
  if (!fs.existsSync(base)) return [];
  const salida = [];
  const caminar = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) caminar(p);
      else salida.push(path.relative(DATA, p).split(path.sep).join("/"));
    }
  };
  caminar(fs.statSync(base).isDirectory() ? base : path.dirname(base));
  return salida;
}

// --- Cola de escritura ------------------------------------------------------
// En serie y no en paralelo: dos UPDATE de la misma clave tienen que quedar en
// el orden en que se pidieron, o la app muestra un valor y la base guarda otro.

function encolar(sql, params) {
  pendientes = pendientes
    .then(() => pool.query(sql, params))
    .catch((e) => {
      fallosDeEscritura++;
      console.error("[almacen] no pude guardar:", e.message);
    });
}

// Para el script de migración y para cerrar prolijo: espera lo que quedó en vuelo.
export async function drenar() {
  await pendientes;
  return { fallosDeEscritura };
}

export async function cerrar() {
  await drenar();
  if (pool) await pool.end();
}
