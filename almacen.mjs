// Dónde viven los datos. Dos backends con la MISMA interfaz sincrona, para que
// el resto del código no se entere de cuál está corriendo:
//
//   disco     — archivos JSON en data/, como siempre. Es el de tu compu.
//   postgres  — para el hosting: allá el disco se borra en cada reinicio, así
//               que un archivo no es un lugar donde guardar nada.
//
// El de postgres carga TODO a memoria al arrancar y escribe de fondo. Eso valía
// mientras corría una sola instancia. Ya no: la app de tu compu apunta a la
// MISMA base que la publicada, así que hay dos procesos escribiendo.
//
// Lo que lo hace seguro es refrescar(): antes de contestar cualquier request se
// traen sólo las filas que cambiaron desde la última vez (`actualizado > marca`),
// que casi siempre son cero. Leer la base entera en cada request era la otra
// opción y costaba un segundo por pantalla; esto cuesta una consulta que no
// devuelve nada.
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

// Hasta dónde leímos. Es la marca del reloj DE LA BASE, nunca la de esta
// máquina: dos procesos no tienen por qué tener la hora igual, y un segundo de
// adelanto acá se comería para siempre un cambio hecho allá.
let marca = null;
let refrescoEnVuelo = null;

// clave -> el sello de fecha que ya aplicamos de esa clave. Es lo que evita
// volver a traer el contenido de una fila que ya tenemos, porque la ventana de
// solapamiento hace que las mismas filas caigan en varias pasadas seguidas.
let aplicado = new Map();

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
    // Un "sslmode=disable" escrito a mano se respeta: es la única forma de
    // apuntar a un Postgres que no habla TLS —el contenedor de los tests, uno
    // en la misma máquina— y es una decisión explícita de quien puso la cadena,
    // no algo en lo que se pueda caer por descuido. Contra Neon no sirve de
    // nada: rechaza la conexión sin cifrar y la app no arranca.
    if (u.searchParams.get("sslmode") === "disable") return url;
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

  // Un borrado no deja fila, así que refrescar() no tiene cómo verlo: para la
  // otra instancia el perfil borrado sigue existiendo. Por eso la lápida.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS borrados (
      clave TEXT PRIMARY KEY,
      fecha TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Índices para que refrescar() no barra la tabla entera en cada request.
  await pool.query("CREATE INDEX IF NOT EXISTS archivos_actualizado ON archivos (actualizado)");
  await pool.query("CREATE INDEX IF NOT EXISTS borrados_fecha ON borrados (fecha)");

  // La marca sale del reloj de la base y se toma ANTES de leer: si algo se
  // escribe entre el SELECT y esta línea, la próxima pasada lo trae igual.
  // Al revés —tomarla después— ese cambio no se vería nunca.
  const { rows: [t] } = await pool.query("SELECT now() AS ahora");
  marca = t.ahora;

  const { rows } = await pool.query(
    "SELECT clave, valor, actualizado::text AS sello FROM archivos");
  memoria = new Map(rows.map(r => [r.clave, r.valor]));
  // Con qué fecha quedó cada una: si no, el primer refresco vuelve a traer el
  // contenido de todo lo escrito en los últimos diez segundos sin necesidad.
  aplicado = new Map(rows.map(r => [r.clave, r.sello]));

  // Las lápidas viejas ya no le sirven a nadie: cualquier instancia que estuvo
  // caída un mes recarga entera al arrancar.
  pool.query("DELETE FROM borrados WHERE fecha < now() - interval '30 days'")
    .catch(() => { /* limpieza, no es crítico */ });

  modo = "postgres";
  return modo;
}

// --- Traer lo que cambió en la base -----------------------------------------
// Esto es lo que permite que la app de tu compu y la publicada sean la misma
// cosa. Se llama antes de contestar cada request: casi siempre son cero filas.
//
// Devuelve las claves que cambiaron, para que quien llame pueda tirar lo que
// derivó de ellas (los perfiles armados, las colas de recomendación).

export function refrescar() {
  if (modo !== "postgres") return Promise.resolve(null);
  // Si ya hay una pasada en vuelo, esperamos esa en vez de disparar otra: al
  // cargar la pantalla salen varios fetch juntos y no hace falta preguntarle
  // lo mismo a la base cinco veces.
  if (!refrescoEnVuelo) {
    refrescoEnVuelo = hacerRefresco().finally(() => { refrescoEnVuelo = null; });
  }
  return refrescoEnVuelo;
}

// Cuánto se mira hacia atrás, además de lo posterior a la marca.
//
// Hace falta porque now() en Postgres es la hora en que ARRANCÓ la transacción,
// no la del commit. Entre las dos hay milisegundos, y ahí se cuela un cambio que
// no se ve NUNCA MÁS: la otra instancia escribe con fecha T1, todavía sin
// commitear; ésta toma su marca en T2 > T1 y no lo ve porque no está commiteado;
// cuando después pregunta "¿qué hay después de T2?", esa fila tiene T1 y queda
// afuera para siempre. Verificado contra un Postgres de verdad, no deducido.
//
// Con la ventana, la fila vuelve a caer dentro del rango en la pasada siguiente.
// Diez segundos es mucho más que lo que tarda un INSERT contra Neon, y lo que
// cuesta de más lo paga la deduplicación de abajo.
const VENTANA = "10 seconds";

async function hacerRefresco() {
  const cambiadas = new Set();
  try {
    // Primero que aterrice lo nuestro. Si no, una escritura todavía en la cola
    // se pisa con la fila vieja que devuelve el SELECT de abajo.
    await drenar();

    const { rows: [t] } = await pool.query("SELECT now() AS ahora");

    // Paso 1: sólo claves y fechas, sin los valores. Como la ventana hace que
    // las mismas filas caigan varias veces seguidas, traer el contenido en este
    // paso sería mandar puntuaciones.json entero una y otra vez.
    //
    // La fecha viaja como texto y no como Date: el driver recorta a
    // milisegundos y dos escrituras dentro del mismo milisegundo quedarían
    // iguales, así que la segunda se tomaría por ya aplicada. El texto de la
    // base trae los microsegundos.
    // La ventana va como parámetro y no pegada al string: es una constante de
    // este archivo y no la toca nadie de afuera, pero una query armada con
    // concatenación es lo que uno no quiere tener que mirar dos veces.
    const { rows: probe } = await pool.query(
      `SELECT clave, actualizado::text AS sello, actualizado AS t, 'alta' AS tipo
         FROM archivos  WHERE actualizado > $1::timestamptz - $2::interval
       UNION ALL
       SELECT clave, fecha::text       AS sello, fecha       AS t, 'baja' AS tipo
         FROM borrados  WHERE fecha       > $1::timestamptz - $2::interval
       ORDER BY t ASC`, [marca, VENTANA]);

    // Una clave puede aparecer como alta Y como baja si se borró y se volvió a
    // crear dentro de la ventana. Vale sólo el último evento: aplicar los dos
    // en orden dejaría a `aplicado` con una fecha, y en la pasada siguiente el
    // otro evento se vería como nuevo y resucitaría un borrado.
    const ultimo = new Map();
    for (const r of probe) ultimo.set(r.clave, r);      // vienen ordenadas por t

    const nuevas = [...ultimo.values()].filter(r => aplicado.get(r.clave) !== r.sello);

    if (nuevas.length) {
      // Paso 2: ahora sí, los valores, y sólo de lo que de verdad cambió.
      const aTraer = nuevas.filter(r => r.tipo === "alta").map(r => r.clave);
      const valores = new Map();
      if (aTraer.length) {
        const { rows } = await pool.query(
          "SELECT clave, valor FROM archivos WHERE clave = ANY($1)", [aTraer]);
        for (const r of rows) valores.set(r.clave, r.valor);
      }
      for (const r of nuevas.sort((a, b) => a.t - b.t)) {
        if (r.tipo === "alta") {
          // Si no vino, se borró entre los dos pasos: lo agarra la próxima.
          if (!valores.has(r.clave)) continue;
          memoria.set(r.clave, valores.get(r.clave));
        } else {
          memoria.delete(r.clave);
        }
        aplicado.set(r.clave, r.sello);
        cambiadas.add(r.clave);
      }
    }

    marca = t.ahora;
    // `aplicado` no se poda: tiene una entrada por clave, igual que `memoria`,
    // y guarda una fecha corta donde la otra guarda el archivo entero. Podarla
    // por antigüedad obligaba a parsear el texto de fecha de Postgres, que es
    // una dependencia del DateStyle de la base a cambio de nada.
  } catch (e) {
    // Sin base no se rompe la pantalla: se sigue con lo que hay en memoria y
    // la marca queda donde estaba, así la próxima pasada trae todo lo perdido.
    console.error("[almacen] no pude refrescar:", e.message);
  }
  return cambiadas;
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
  const { rows: [t] } = await pool.query("SELECT now() AS ahora");
  const { rows } = await pool.query(
    "SELECT clave, valor, actualizado::text AS sello FROM archivos");
  memoria = new Map(rows.map(r => [r.clave, r.valor]));
  aplicado = new Map(rows.map(r => [r.clave, r.sello]));
  marca = t.ahora;                      // arrancamos de cero: la marca también
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
    // Si la clave estaba enterrada y vuelve, la lápida sale: si no, la otra
    // instancia la borraría de nuevo apenas refresque.
    encolar("DELETE FROM borrados WHERE clave = $1", [clave]);
    return valor;
  }
  const f = rutaDe(clave);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(valor, null, 2));
  return valor;
}

// --- Cambiar un documento sin pisar a la otra instancia -----------------------
//
// escribir() manda el valor entero y sin condiciones: el último que llega gana.
// Con un solo proceso eso era correcto. Con dos deja de serlo para todo lo que
// se lee-modifica-escribe, y hay una fila donde eso es grave: cuentas.json, que
// tiene TODAS las cuentas juntas. Cambiar una contraseña, o "cerrar sesión en
// todos lados", es levantar el arreglo entero, tocar un campo y devolverlo. Si
// entremedio la otra instancia escribió, se lo lleva puesto — y volver atrás un
// cierre de sesión es deshacer una medida de seguridad en silencio, sin error y
// sin que quede rastro. Lo mismo con las invitaciones: una dada de baja vuelve a
// servir. Y los usos de una invitación son un contador, que es el caso de libro.
//
// Acá no se manda un valor sino una FUNCIÓN, y se aplica sobre lo que hay en la
// base en ese momento. Si alguien escribió en el medio, el UPDATE no engancha
// —va condicionado a la fecha que se leyó— y se vuelve a intentar sobre lo
// nuevo. La función tiene que poder correrse más de una vez sin efectos aparte.
//
// La interfaz sigue siendo sincrónica y devuelve enseguida el valor optimista,
// para que quien la llamó pueda contestar el request sin esperar a la base.
export function mutar(clave, fn, def) {
  if (modo !== "postgres") {
    const nuevo = fn(leer(clave, def));
    escribir(clave, nuevo);
    return nuevo;
  }
  // Lo que este proceso va a mostrar mientras la escritura viaja. Sobre una
  // copia: si fn toca el objeto en el lugar, el de memoria queda a medio
  // camino si el intento de abajo falla.
  const optimista = fn(structuredClone(leer(clave, def)));
  memoria.set(clave, optimista);
  encolarTarea(() => aplicarConChequeo(clave, fn, def));
  return optimista;
}

async function aplicarConChequeo(clave, fn, def) {
  for (let intento = 1; intento <= 6; intento++) {
    const { rows } = await pool.query(
      "SELECT valor, actualizado::text AS sello FROM archivos WHERE clave = $1", [clave]);
    const nuevo = fn(rows.length ? rows[0].valor : structuredClone(def));
    const texto = JSON.stringify(nuevo);

    // La condición es la fecha que acabamos de leer: si cambió, perdimos.
    const r = rows.length
      ? await pool.query(
          "UPDATE archivos SET valor = $2, actualizado = now() " +
          "WHERE clave = $1 AND actualizado::text = $3 " +
          "RETURNING actualizado::text AS sello", [clave, texto, rows[0].sello])
      : await pool.query(
          "INSERT INTO archivos (clave, valor, actualizado) VALUES ($1, $2, now()) " +
          "ON CONFLICT (clave) DO NOTHING " +
          "RETURNING actualizado::text AS sello", [clave, texto]);

    if (r.rowCount === 1) {
      memoria.set(clave, nuevo);
      aplicado.set(clave, r.rows[0].sello);
      encolar("DELETE FROM borrados WHERE clave = $1", [clave]);
      return;
    }
    // Perdimos la carrera: volvemos a leer y re-aplicamos sobre lo que quedó.
  }

  // Seis intentos seguidos perdidos no es contención, es algo roto. Lo que no
  // se puede hacer es dejar en memoria el valor optimista, que ya sabemos que
  // no es lo que dice la base: mejor mostrar la verdad ajena que una propia
  // que no existe.
  fallosDeEscritura++;
  console.error("[almacen] no pude guardar " + clave + " sin pisar a la otra instancia");
  const { rows } = await pool.query(
    "SELECT valor, actualizado::text AS sello FROM archivos WHERE clave = $1", [clave]);
  if (rows.length) {
    memoria.set(clave, rows[0].valor);
    aplicado.set(clave, rows[0].sello);
  }
}

export function borrar(clave) {
  if (modo === "postgres") {
    memoria.delete(clave);
    encolar("DELETE FROM archivos WHERE clave = $1", [clave]);
    encolar(
      "INSERT INTO borrados (clave, fecha) VALUES ($1, now()) " +
      "ON CONFLICT (clave) DO UPDATE SET fecha = now()", [clave]);
    return;
  }
  try { fs.rmSync(rutaDe(clave), { force: true }); } catch { /* ya no estaba */ }
}

// Borrar "usuarios/nico/" se lleva las puntuaciones, el estado, todo.
export function borrarPrefijo(prefijo) {
  if (modo === "postgres") {
    const like = prefijo.replace(/[%_]/g, "\\$&") + "%";
    // Las lápidas se ponen clave por clave —del otro lado el borrado se aplica
    // sobre el Map— y salen de la BASE, no de memoria: si esta instancia no
    // tenía una fila que la otra sí, igual hay que enterrarla.
    encolar(
      "INSERT INTO borrados (clave, fecha) " +
      "SELECT clave, now() FROM archivos WHERE clave LIKE $1 " +
      "ON CONFLICT (clave) DO UPDATE SET fecha = now()", [like]);
    encolar("DELETE FROM archivos WHERE clave LIKE $1", [like]);
    for (const k of [...memoria.keys()]) if (k.startsWith(prefijo)) memoria.delete(k);
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
  encolarTarea(() => pool.query(sql, params));
}

function encolarTarea(tarea) {
  pendientes = pendientes
    .then(tarea)
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
