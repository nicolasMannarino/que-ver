// Chequeos del login. Levanta el server en modo publicado, sobre un data/
// aparte y descartable, y prueba lo que tiene que ser cierto para poder dejar
// esto en internet. No toca tu carpeta data/ ni pega contra TMDB.
//
//   node test-auth.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PUERTO = 5199;
const BASE = "http://localhost:" + PUERTO;
const CAJA = fs.mkdtempSync(path.join(os.tmpdir(), "queverauth-"));

let ok = 0, mal = 0;
const chequeo = (cond, texto) => {
  if (cond) { ok++; console.log("  ok  " + texto); }
  else { mal++; console.log("  MAL " + texto); }
};

// Un fetch que se acuerda de la cookie, como haría un navegador.
function navegador() {
  let cookie = "";
  return async (ruta, opciones = {}) => {
    const headers = { "content-type": "application/json", ...(opciones.headers || {}) };
    if (cookie) headers.cookie = cookie;
    const r = await fetch(BASE + ruta, { ...opciones, headers, redirect: "manual" });
    const set = r.headers.getSetCookie?.()[0] || r.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const texto = await r.text();
    let json = null;
    try { json = JSON.parse(texto); } catch { /* no era json */ }
    return { status: r.status, json, texto, cookie };
  };
}

const esperar = async () => {
  for (let i = 0; i < 100; i++) {
    try { await fetch(BASE + "/api/sesion"); return true; } catch { /* todavía no */ }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error("el servidor no levantó");
};

console.log("\nTest del login\n");

// data/ propio: el server siempre usa el de su carpeta, así que corro una copia
// del código en un directorio temporal.
for (const f of ["server.mjs", "datos.mjs", "motor.mjs", "tmdb.mjs", "ratings.mjs", "almacen.mjs", "auth.mjs"]) {
  fs.copyFileSync(path.join(import.meta.dirname, f), path.join(CAJA, f));
}
fs.cpSync(path.join(import.meta.dirname, "public"), path.join(CAJA, "public"), { recursive: true });

const hijo = spawn(process.execPath, [path.join(CAJA, "server.mjs")], {
  env: {
    ...process.env,
    PORT: String(PUERTO),
    REQUERIR_LOGIN: "1",
    SESSION_SECRET: "secreto-de-prueba-largo-para-que-pase-el-minimo",
    TMDB_API_KEY: "",
    DATABASE_URL: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
hijo.stderr.on("data", d => process.stderr.write("[server] " + d));

const limpiar = () => {
  try { hijo.kill(); } catch { /* ya estaba muerto */ }
  try { fs.rmSync(CAJA, { recursive: true, force: true }); } catch { /* da igual */ }
};

try {
  await esperar();

  const ana = navegador();

  // --- El portón ---
  const sinSesion = await ana("/api/estado");
  chequeo(sinSesion.status === 401, "sin cuenta, /api/estado responde 401 y no datos");

  const puntuarSinSesion = await ana("/api/puntuar", {
    method: "POST", body: JSON.stringify({ key: "movie:1", rating: 10 }),
  });
  chequeo(puntuarSinSesion.status === 401, "sin cuenta, no se puede escribir nada");

  const home = await ana("/");
  chequeo(home.status === 200, "la página sí se sirve sin cuenta (si no, no habría dónde loguearse)");

  // --- Registro ---
  const corta = await ana("/api/registro", {
    method: "POST", body: JSON.stringify({ email: "ana@ejemplo.com", pass: "corta" }),
  });
  chequeo(corta.status === 400, "rechaza contraseñas de menos de 8 caracteres");

  const mailFeo = await ana("/api/registro", {
    method: "POST", body: JSON.stringify({ email: "no-es-un-mail", pass: "unaClaveLarga1" }),
  });
  chequeo(mailFeo.status === 400, "rechaza un mail que no es un mail");

  const alta = await ana("/api/registro", {
    method: "POST", body: JSON.stringify({ email: "ana@ejemplo.com", pass: "unaClaveLarga1" }),
  });
  chequeo(alta.status === 200 && alta.json?.cuenta?.email === "ana@ejemplo.com", "se puede crear una cuenta");
  chequeo(!JSON.stringify(alta.json).includes("hash") && !JSON.stringify(alta.json).includes("sal"),
          "la respuesta no filtra el hash ni la sal de la contraseña");

  const repetida = await ana("/api/registro", {
    method: "POST", body: JSON.stringify({ email: "ANA@ejemplo.com", pass: "otraClaveLarga1" }),
  });
  chequeo(repetida.status === 400, "no deja registrar dos veces el mismo mail (ni cambiando mayúsculas)");

  // --- Ya adentro ---
  const estado = await ana("/api/estado");
  chequeo(estado.status === 200, "con cuenta, /api/estado responde");
  chequeo(estado.json?.usuarios?.length === 1, "la cuenta nueva arranca con un perfil");
  chequeo(estado.json?.tieneKey === false, "arranca sin API key de TMDB, esperando la suya");
  const perfilDeAna = estado.json.usuarios[0].id;

  // --- La otra persona ---
  const beto = navegador();
  await beto("/api/registro", {
    method: "POST", body: JSON.stringify({ email: "beto@ejemplo.com", pass: "claveDeBeto12" }),
  });
  const estadoBeto = await beto("/api/estado");
  const perfilDeBeto = estadoBeto.json.usuarios[0].id;

  chequeo(perfilDeAna !== perfilDeBeto, "cada cuenta tiene su propio perfil, con id distinto");
  chequeo(estadoBeto.json.usuarios.length === 1, "Beto ve UN perfil: el suyo, no el de Ana");

  // Lo importante de todo esto: que ?u= no sea una llave maestra.
  const espiar = await beto("/api/estado?u=" + encodeURIComponent(perfilDeAna));
  chequeo(espiar.status === 400, "Beto NO puede leer el perfil de Ana poniendo ?u= en la URL");

  const escribirEncima = await beto("/api/puntuar?u=" + encodeURIComponent(perfilDeAna), {
    method: "POST", body: JSON.stringify({ key: "movie:603", kind: "movie", tmdbId: 603, titulo: "Colada", rating: 1 }),
  });
  chequeo(escribirEncima.status === 400, "Beto NO puede escribir en el perfil de Ana");

  const borrarAjeno = await beto("/api/usuarios/borrar", {
    method: "POST", body: JSON.stringify({ id: perfilDeAna }),
  });
  chequeo(borrarAjeno.status === 400, "Beto NO puede borrar el perfil de Ana");

  const anaSigue = await ana("/api/estado");
  chequeo(anaSigue.status === 200 && anaSigue.json.usuarios.length === 1,
          "después de todo eso, el perfil de Ana sigue entero");

  // --- Contraseñas ---
  const carlos = navegador();
  const malPass = await carlos("/api/entrar", {
    method: "POST", body: JSON.stringify({ email: "ana@ejemplo.com", pass: "noEsLaClave1" }),
  });
  chequeo(malPass.status === 400, "con la contraseña mal no entra");
  chequeo(malPass.json?.error === "Mail o contraseña incorrectos.",
          "el error no revela si el mail existe o no");

  const inexistente = await carlos("/api/entrar", {
    method: "POST", body: JSON.stringify({ email: "nadie@ejemplo.com", pass: "loQueSea123" }),
  });
  chequeo(inexistente.json?.error === malPass.json?.error,
          "mail inexistente y contraseña mal dan el MISMO error");

  const bien = await carlos("/api/entrar", {
    method: "POST", body: JSON.stringify({ email: "ana@ejemplo.com", pass: "unaClaveLarga1" }),
  });
  chequeo(bien.status === 200, "con la contraseña bien, entra");

  const comoAna = await carlos("/api/estado");
  chequeo(comoAna.json?.usuarios?.[0]?.id === perfilDeAna,
          "entrando desde otro dispositivo ve SUS datos (esto es lo del celular)");

  // --- Cookie firmada ---
  const falsificador = async (cookie) => {
    const r = await fetch(BASE + "/api/estado", { headers: { cookie } });
    return r.status;
  };
  const cookieDeAna = bien.cookie;
  const [dato] = cookieDeAna.split("=")[1].split(".");
  chequeo(await falsificador("qv_sesion=" + dato + ".firmatrucha") === 401,
          "una cookie con la firma cambiada no sirve");
  chequeo(await falsificador("qv_sesion=" + dato) === 401,
          "una cookie sin firma no sirve");

  // --- Salir ---
  const salida = await carlos("/api/salir", { method: "POST" });
  chequeo(salida.status === 200, "salir responde ok");
  chequeo((salida.cookie || "").endsWith("="), "salir vacía la cookie");

  // --- La contraseña en reposo ---
  const cuentas = JSON.parse(fs.readFileSync(path.join(CAJA, "data", "cuentas.json"), "utf8"));
  chequeo(!JSON.stringify(cuentas).includes("unaClaveLarga1"),
          "la contraseña NO queda guardada en ningún lado en texto plano");
  chequeo(cuentas.every(c => c.hash && c.sal && c.hash.length >= 64),
          "queda un hash con sal, no la contraseña");
  chequeo(new Set(cuentas.map(c => c.sal)).size === cuentas.length,
          "cada cuenta tiene su propia sal");
} finally {
  limpiar();
}

console.log("\n" + (mal ? `  ${mal} MAL, ${ok} bien\n` : "Todo verde.\n"));
process.exit(mal ? 1 : 0);
