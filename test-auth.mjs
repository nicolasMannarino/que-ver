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
const titulo = (t) => console.log("\n--- " + t + " ---");

// Un fetch que se acuerda de la cookie, como haría un navegador.
function navegador() {
  let cookie = "";
  const f = async (ruta, opciones = {}) => {
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
  f.cookieActual = () => cookie;
  return f;
}
const POST = (body) => ({ method: "POST", body: JSON.stringify(body) });

const esperar = async () => {
  for (let i = 0; i < 100; i++) {
    try { await fetch(BASE + "/api/sesion"); return true; } catch { /* todavía no */ }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error("el servidor no levantó");
};

console.log("\nTest del login");

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
    ADMIN_EMAILS: "",
    REGISTRO_PERMITIDO: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
hijo.stderr.on("data", d => process.stderr.write("[server] " + d));

const limpiar = () => {
  try { hijo.kill(); } catch { /* ya estaba muerto */ }
  try { fs.rmSync(CAJA, { recursive: true, force: true }); } catch { /* da igual */ }
};

const CLAVE_ANA = "unaClaveLarga1";
const CLAVE_BETO = "MiClaveSegura24";

try {
  await esperar();
  const ana = navegador();

  titulo("1. El portón");
  chequeo((await ana("/api/estado")).status === 401, "sin cuenta, /api/estado responde 401 y no datos");
  chequeo((await ana("/api/puntuar", POST({ key: "movie:1", rating: 10 }))).status === 401,
          "sin cuenta, no se puede escribir nada");
  chequeo((await ana("/api/invitaciones")).status === 401, "sin cuenta, no se listan invitaciones");
  chequeo((await ana("/")).status === 200,
          "la página sí se sirve sin cuenta (si no, no habría dónde loguearse)");

  titulo("2. La vara de las contraseñas");
  const rechaza = async (pass, por) => {
    const r = await ana("/api/registro", POST({ email: "prueba@ejemplo.com", pass }));
    chequeo(r.status === 400, "rechaza " + por + ": «" + pass + "»");
  };
  await rechaza("corta", "las de menos de 10");
  await rechaza("123456789", "las de menos de 10 aunque sean números");
  await rechaza("password1", "las que están en toda filtración");
  await rechaza("aaaaaaaaaaaa", "una sola letra repetida");
  await rechaza("solominusculas", "las de un solo tipo de caracter");
  await rechaza("prueba12345", "las que contienen tu propio mail");

  titulo("3. La primera cuenta");
  const alta = await ana("/api/registro", POST({ email: "ana@ejemplo.com", pass: CLAVE_ANA }));
  chequeo(alta.status === 200 && alta.json?.cuenta?.email === "ana@ejemplo.com",
          "la primera cuenta se crea sin código (no hay quien la invite)");
  chequeo(alta.json?.cuenta?.admin === true, "y queda como dueña de la app");
  chequeo(!JSON.stringify(alta.json).includes("hash") && !JSON.stringify(alta.json).includes("sal"),
          "la respuesta no filtra el hash ni la sal de la contraseña");

  const repetida = await ana("/api/registro", POST({ email: "ANA@ejemplo.com", pass: "otraClaveLarga1" }));
  chequeo(repetida.status === 400, "no deja repetir el mismo mail (ni cambiando mayúsculas)");

  const estado = await ana("/api/estado");
  chequeo(estado.json?.usuarios?.length === 1, "la cuenta nueva arranca con un perfil");
  chequeo(estado.json?.tieneKey === false, "arranca sin API key de TMDB, esperando la suya");
  const perfilDeAna = estado.json.usuarios[0].id;

  titulo("4. Sin invitación no se entra");
  const cuela = navegador();
  const sinCodigo = await cuela("/api/registro", POST({ email: "intruso@ejemplo.com", pass: "NoMeDejanPasar7" }));
  chequeo(sinCodigo.status === 400, "un desconocido NO puede crearse una cuenta sin código");
  chequeo(/c[oó]digo/i.test(sinCodigo.json?.error || ""), "y el error le dice que hace falta un código");

  const inventado = await cuela("/api/registro",
    POST({ email: "intruso@ejemplo.com", pass: "NoMeDejanPasar7", codigo: "AAAA-BBBB-CCCC-DDDD" }));
  chequeo(inventado.status === 400, "un código inventado tampoco sirve");
  chequeo((await cuela("/api/estado")).status === 401, "y sigue sin poder ver nada");

  titulo("5. Invitaciones");
  const gen = await ana("/api/invitaciones", POST({ etiqueta: "Papá", maxUsos: 1, dias: 7 }));
  chequeo(gen.status === 200 && /^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/.test(gen.json?.codigo || ""),
          "la dueña genera un código con formato legible (" + gen.json?.codigo + ")");
  const codigo = gen.json.codigo;

  const guardadas = JSON.parse(fs.readFileSync(path.join(CAJA, "data", "invitaciones.json"), "utf8"));
  chequeo(!JSON.stringify(guardadas).includes(codigo.replace(/-/g, "")),
          "el código NO queda guardado en claro, solo su hash");
  const listadas = await ana("/api/invitaciones");
  chequeo(!JSON.stringify(listadas.json).includes(guardadas[0].hash),
          "y el hash entero tampoco sale a la web");

  titulo("6. Usar la invitación");
  const beto = navegador();
  const conCodigo = await beto("/api/registro", POST({ email: "beto@ejemplo.com", pass: CLAVE_BETO, codigo }));
  chequeo(conCodigo.status === 200, "con el código, Beto sí puede crear su cuenta");
  chequeo(conCodigo.json?.cuenta?.admin === false, "pero NO queda como dueño de la app");

  const reuso = await navegador()("/api/registro",
    POST({ email: "otro@ejemplo.com", pass: "ReusoDelCodigo9", codigo }));
  chequeo(reuso.status === 400, "el mismo código no se puede usar dos veces");

  const conGuion = await ana("/api/invitaciones", POST({ etiqueta: "sin guiones", maxUsos: 1 }));
  const pegado = await navegador()("/api/registro",
    POST({ email: "pegado@ejemplo.com", pass: "claveNormal12", codigo: conGuion.json.codigo.replace(/-/g, "").toLowerCase() }));
  chequeo(pegado.status === 200, "el código anda igual sin guiones y en minúscula");

  titulo("7. Dar de baja una invitación");
  const paraRevocar = await ana("/api/invitaciones", POST({ etiqueta: "me arrepentí", maxUsos: 5 }));
  const cual = paraRevocar.json.lista[0].id;
  chequeo((await ana("/api/invitaciones/revocar", POST({ id: cual }))).status === 200, "se puede dar de baja");
  const revocado = await navegador()("/api/registro",
    POST({ email: "tarde@ejemplo.com", pass: "claveTardia12", codigo: paraRevocar.json.codigo }));
  chequeo(revocado.status === 400, "y el código deja de servir aunque le queden usos");

  titulo("8. Solo el dueño invita");
  const betoInvita = await beto("/api/invitaciones", POST({ etiqueta: "de contrabando" }));
  chequeo(betoInvita.status === 400, "Beto NO puede generar invitaciones");
  chequeo((await beto("/api/invitaciones")).json?.lista?.length === 0, "ni ver las que existen");

  titulo("9. Los datos de cada uno");
  const estadoBeto = await beto("/api/estado");
  const perfilDeBeto = estadoBeto.json.usuarios[0].id;
  chequeo(perfilDeAna !== perfilDeBeto, "cada cuenta tiene su propio perfil, con id distinto");
  chequeo(estadoBeto.json.usuarios.length === 1, "Beto ve UN perfil: el suyo, no el de Ana");
  chequeo((await beto("/api/estado?u=" + encodeURIComponent(perfilDeAna))).status === 400,
          "Beto NO puede leer el perfil de Ana poniendo ?u= en la URL");
  chequeo((await beto("/api/puntuar?u=" + encodeURIComponent(perfilDeAna),
            POST({ key: "movie:603", kind: "movie", tmdbId: 603, titulo: "Colada", rating: 1 }))).status === 400,
          "Beto NO puede escribir en el perfil de Ana");
  chequeo((await beto("/api/usuarios/borrar", POST({ id: perfilDeAna }))).status === 400,
          "Beto NO puede borrar el perfil de Ana");
  const anaSigue = await ana("/api/estado");
  chequeo(anaSigue.status === 200 && anaSigue.json.usuarios.length === 1,
          "después de todo eso, el perfil de Ana sigue entero");

  titulo("10. Entrar");
  const carlos = navegador();
  const malPass = await carlos("/api/entrar", POST({ email: "ana@ejemplo.com", pass: "noEsLaClave1" }));
  chequeo(malPass.status === 400, "con la contraseña mal no entra");
  const inexistente = await carlos("/api/entrar", POST({ email: "nadie@ejemplo.com", pass: "loQueSea123" }));
  chequeo(inexistente.json?.error === malPass.json?.error,
          "mail inexistente y contraseña mal dan el MISMO error (no revela quién existe)");
  const bien = await carlos("/api/entrar", POST({ email: "ana@ejemplo.com", pass: CLAVE_ANA }));
  chequeo(bien.status === 200, "con la contraseña bien, entra");
  chequeo((await carlos("/api/estado")).json?.usuarios?.[0]?.id === perfilDeAna,
          "entrando desde otro dispositivo ve SUS datos (esto es lo del celular)");

  titulo("11. La cookie");
  const conCookie = async (cookie) => (await fetch(BASE + "/api/estado", { headers: { cookie } })).status;
  const [dato] = bien.cookie.split("=")[1].split(".");
  chequeo(await conCookie("qv_sesion=" + dato + ".firmatrucha") === 401, "una cookie con la firma cambiada no sirve");
  chequeo(await conCookie("qv_sesion=" + dato) === 401, "una cookie sin firma no sirve");

  titulo("12. Cerrar sesión en todos lados");
  const celular = navegador();
  await celular("/api/entrar", POST({ email: "ana@ejemplo.com", pass: CLAVE_ANA }));
  chequeo((await celular("/api/estado")).status === 200, "Ana entra desde un segundo dispositivo");
  const viejaDelCelu = celular.cookieActual();

  chequeo((await ana("/api/salir-de-todos", POST({}))).status === 200, "y cierra todo desde la compu");
  chequeo(await conCookie(viejaDelCelu) === 401, "la sesión del celular queda muerta");
  chequeo((await ana("/api/estado")).status === 401, "y la de la compu también");

  const devuelta = navegador();
  chequeo((await devuelta("/api/entrar", POST({ email: "ana@ejemplo.com", pass: CLAVE_ANA }))).status === 200,
          "pero puede volver a entrar con la misma contraseña");
  chequeo((await devuelta("/api/estado")).json?.usuarios?.[0]?.id === perfilDeAna, "y sus datos siguen ahí");

  titulo("13. Lo guardado");
  const cuentas = JSON.parse(fs.readFileSync(path.join(CAJA, "data", "cuentas.json"), "utf8"));
  chequeo(!JSON.stringify(cuentas).includes(CLAVE_ANA) && !JSON.stringify(cuentas).includes(CLAVE_BETO),
          "ninguna contraseña queda guardada en texto plano");
  chequeo(cuentas.every(c => c.hash && c.sal && c.hash.length >= 64), "queda un hash con sal, no la contraseña");
  chequeo(new Set(cuentas.map(c => c.sal)).size === cuentas.length, "cada cuenta tiene su propia sal");
} finally {
  limpiar();
}

console.log("\n" + (mal ? `  ${mal} MAL, ${ok} bien\n` : `Todo verde. (${ok} chequeos)\n`));
process.exit(mal ? 1 : 0);
