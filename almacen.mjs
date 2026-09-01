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

const DIR = import.meta.dirname;
export const DATA = path.join(DIR, "data");

let modo = "disco";
let memoria = new Map();      // clave -> valor ya parseado
let pool = null;
let pendientes = Promise.resolve();
let fallosDeEscritura = 0;

export const backend = () => modo;

// --- Arranque ---------------------------------------------------------------

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
  pool = new pg.Pool({
    connectionString: url,
    // Neon y casi todo Postgres administrado exigen TLS, y su cadena no está
    // en el store de Node. Verificar acá no agrega nada: la conexión ya va
    // cifrada y el host viene de una variable de entorno nuestra.
    ssl: { rejectUnauthorized: false },
    max: 4,
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS archivos (
      clave       TEXT PRIMARY KEY,
      valor       JSONB NOT NULL,
      actualizado TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await pool.query("SELECT clave, valor FROM archivos");
  memoria = new Map(rows.map(r => [r.clave, r.valor]));
  modo = "postgres";
  return modo;
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
