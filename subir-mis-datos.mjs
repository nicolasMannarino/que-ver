// Sube las puntuaciones que tenés en esta compu a tu cuenta de la app publicada.
// Es lo que hace que entres desde el celular y veas lo mismo que acá.
//
//   node subir-mis-datos.mjs --url "<DATABASE_URL de Neon>" --mail vos@ejemplo.com
//
// Opciones:
//   --secreto <s>   el mismo SESSION_SECRET de Render. Solo hace falta si querés
//                   subir también tu API key de TMDB, que va cifrada con él.
//   --perfiles a,b  cuáles subir. Por defecto, todos los de esta compu.
//   --de-nuevo      pisa los perfiles que ya estén arriba.
//   --ensayo        muestra qué haría y no escribe nada.
//
// La cuenta tiene que existir: registrate primero en la web, y después corré
// esto. Así la contraseña la elegís vos en el navegador y no viaja por acá.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DIR = import.meta.dirname;
const DATA = path.join(DIR, "data");

// --- Argumentos -------------------------------------------------------------
const args = process.argv.slice(2);
const opcion = (nombre, def = null) => {
  const i = args.indexOf("--" + nombre);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : def;
};
const bandera = (nombre) => args.includes("--" + nombre);

const URL_BASE = opcion("url") || process.env.DATABASE_URL;
const MAIL = (opcion("mail") || "").trim().toLowerCase();
const SECRETO = opcion("secreto") || process.env.SESSION_SECRET || "";
const SOLO = (opcion("perfiles") || "").split(",").map(s => s.trim()).filter(Boolean);
const DE_NUEVO = bandera("de-nuevo");
const ENSAYO = bandera("ensayo");

const morir = (msg) => { console.error("\n  " + msg + "\n"); process.exit(1); };

if (!URL_BASE) morir("Falta --url con la DATABASE_URL de Neon (la copiás del panel de Neon).");
if (!MAIL) morir("Falta --mail con el mail de la cuenta que creaste en la web.");

// --- Lo que hay en esta compu -----------------------------------------------
const leerLocal = (rel, def) => {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, rel), "utf8")); }
  catch { return def; }
};

const locales = leerLocal("usuarios.json", []);
if (!locales.length) morir("No encontré ningún perfil en data/usuarios.json.");

const aSubir = SOLO.length ? locales.filter(u => SOLO.includes(u.id)) : locales;
if (!aSubir.length) morir("Ninguno de los perfiles que pediste existe acá. Hay: " + locales.map(u => u.id).join(", "));

console.log("\n  Perfiles en esta compu:");
for (const u of aSubir) {
  const n = leerLocal("usuarios/" + u.id + "/puntuaciones.json", []).length;
  console.log(`    ${u.nombre} (${u.id})  —  ${n} puntuaciones`);
}

// --- Conectar ---------------------------------------------------------------
const { default: pg } = await import("pg");
const pool = new pg.Pool({ connectionString: URL_BASE, ssl: { rejectUnauthorized: false }, max: 2 });

const traer = async (clave, def) => {
  const { rows } = await pool.query("SELECT valor FROM archivos WHERE clave = $1", [clave]);
  return rows.length ? rows[0].valor : def;
};
const poner = async (clave, valor) => {
  if (ENSAYO) { console.log("    [ensayo] escribiría " + clave); return; }
  await pool.query(
    "INSERT INTO archivos (clave, valor, actualizado) VALUES ($1, $2, now()) " +
    "ON CONFLICT (clave) DO UPDATE SET valor = $2, actualizado = now()",
    [clave, JSON.stringify(valor)],
  );
};

try {
  const { rows: tabla } = await pool.query(
    "SELECT to_regclass('public.archivos') IS NOT NULL AS existe");
  if (!tabla[0].existe) {
    morir("En la base todavía no hay nada. Abrí la app publicada una vez para que se cree la tabla, y volvé a correr esto.");
  }

  const cuentas = await traer("cuentas.json", []);
  const cuenta = cuentas.find(c => c.email === MAIL);
  if (!cuenta) {
    morir("No hay ninguna cuenta con el mail «" + MAIL + "».\n" +
          "  Registrate primero en la web y después corré esto.\n" +
          "  Cuentas que hay: " + (cuentas.map(c => c.email).join(", ") || "ninguna"));
  }
  console.log("\n  Cuenta destino: " + cuenta.email);

  const remotos = await traer("usuarios.json", []);
  const nuevos = [...remotos];
  let subidos = 0, salteados = 0;

  for (const u of aSubir) {
    // El id del perfil es la clave del almacén y es único entre TODAS las
    // cuentas: si allá arriba ya existe uno con ese id y no es tuyo, hay que
    // renombrar el que sube o dos personas escribirían en el mismo lugar.
    const yaEsta = remotos.find(r => r.id === u.id);
    let id = u.id;
    if (yaEsta && yaEsta.cuenta !== cuenta.id) {
      let n = 2;
      while (remotos.some(r => r.id === id)) id = u.id + "-" + n++;
      console.log(`    ${u.id} ya existía en otra cuenta -> sube como ${id}`);
    } else if (yaEsta && !DE_NUEVO) {
      console.log(`    ${u.id} ya está arriba, lo salteo (usá --de-nuevo para pisarlo)`);
      salteados++;
      continue;
    }

    for (const archivo of ["puntuaciones.json", "estado.json", "preferencias.json", "mapeo.json"]) {
      const contenido = leerLocal("usuarios/" + u.id + "/" + archivo, null);
      if (contenido !== null) await poner("usuarios/" + id + "/" + archivo, contenido);
    }

    const entrada = { id, nombre: u.nombre, cuenta: cuenta.id };
    const i = nuevos.findIndex(r => r.id === id);
    if (i >= 0) nuevos[i] = entrada; else nuevos.push(entrada);
    subidos++;
    console.log(`    ${u.nombre} -> ${id}  listo`);
  }

  if (subidos) await poner("usuarios.json", nuevos);

  // --- La API key, si la pediste ---
  if (SECRETO) {
    const local = leerLocal("config.json", {});
    if (local.tmdbKey) {
      const crypto = await import("node:crypto");
      const claveDe = (uso) => crypto.createHash("sha256").update(SECRETO + "|" + uso).digest();
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv("aes-256-gcm", claveDe("tmdb"), iv);
      const dato = Buffer.concat([c.update(local.tmdbKey, "utf8"), c.final()]);
      const cifrada = [iv.toString("base64url"), c.getAuthTag().toString("base64url"), dato.toString("base64url")].join(".");
      const lista = await traer("cuentas.json", []);
      const suya = lista.find(x => x.id === cuenta.id);
      suya.tmdbKey = cifrada;
      await poner("cuentas.json", lista);
      console.log("\n  Tu API key de TMDB quedó cargada y cifrada en tu cuenta.");
    }
  } else {
    console.log("\n  (Sin --secreto no subí la API key: la cargás desde la web, que es más simple.)");
  }

  console.log(`\n  Listo: ${subidos} perfil(es) subido(s)` + (salteados ? `, ${salteados} salteado(s)` : "") +
              (ENSAYO ? "  [ENSAYO: no se escribió nada]" : "") + "\n");
} finally {
  await pool.end();
}
