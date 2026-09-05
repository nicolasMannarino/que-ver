// La app de tu compu y la publicada son la MISMA app.
//
// Levanta DOS servers contra la misma base, como pasa de verdad: uno es Render
// y el otro el de tu escritorio. Puntúa en uno y exige verlo en el otro, en las
// dos direcciones. Es el test de lo que se pidió, y el único que prueba el
// escenario entero —cookie, sesión, almacén, invalidación de perfiles— junto.
//
//   docker run -d --name qv-pg-test -e POSTGRES_PASSWORD=qv -p 5433:5432 postgres:16-alpine
//   TEST_DATABASE_URL="postgres://postgres:qv@localhost:5433/postgres?sslmode=disable" node test-dos-instancias.mjs
//
// No necesita API key de TMDB: /api/estado cuenta puntuaciones sin salir a la red.
import { spawn } from "node:child_process";
import process from "node:process";

const URL_TEST = process.env.TEST_DATABASE_URL;
if (!URL_TEST) {
  console.log("\n  test-dos-instancias: SALTEADO (falta TEST_DATABASE_URL)\n");
  process.exit(0);
}
if (/neon\.tech|render\.com|amazonaws/i.test(URL_TEST)) {
  console.error("\n  Apunta a una base alojada y este test la escribe. Usá una descartable.\n");
  process.exit(1);
}

let fallos = 0, hechos = 0;
const ok = (cond, que) => {
  hechos++;
  console.log((cond ? "  ok  " : "  NO  ") + que);
  if (!cond) fallos++;
};
const seccion = (t) => console.log("\n--- " + t + " ---");

// Las dos comparten SESSION_SECRET, como Render y tu compu: es lo que hace que
// la misma cookie valga en las dos y que la API key cifrada se pueda descifrar
// de los dos lados.
const SECRETO = "x".repeat(48);
const entorno = (puerto) => ({
  ...process.env,
  DATABASE_URL: URL_TEST,
  SESSION_SECRET: SECRETO,
  PORT: String(puerto),
  HOST: "127.0.0.1",
  TMDB_API_KEY: "",
  MANTENER_DESPIERTO: "",
});

const procesos = [];
function levantar(puerto) {
  const p = spawn(process.execPath, ["server.mjs"], {
    env: entorno(puerto), stdio: ["ignore", "pipe", "pipe"],
  });
  procesos.push(p);
  p.stderr.on("data", d => {
    const t = String(d);
    if (!/calentar|ExperimentalWarning/.test(t)) process.stderr.write("    [" + puerto + "] " + t);
  });
  return new Promise((resolve, reject) => {
    const limite = setTimeout(() => reject(new Error("no arrancó el " + puerto)), 30000);
    p.stdout.on("data", d => {
      if (/Qué Ver/.test(String(d))) { clearTimeout(limite); setTimeout(resolve, 400); }
    });
  });
}

const base = (puerto) => "http://127.0.0.1:" + puerto;
let cookie = "";
async function pedir(puerto, ruta, opciones = {}) {
  const r = await fetch(base(puerto) + ruta, {
    ...opciones,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(opciones.headers || {}),
    },
  });
  // getSetCookie() y no get("set-cookie"): el segundo devuelve las cookies
  // pegoteadas en una sola cadena y cortarla por ";" se lleva medio valor.
  const set = r.headers.getSetCookie?.() || [];
  if (set.length) cookie = set[0].split(";")[0];
  const texto = await r.text();
  try { return { status: r.status, json: JSON.parse(texto) }; }
  catch { return { status: r.status, texto }; }
}

// --- Base limpia ------------------------------------------------------------
const { default: pg } = await import("pg");
const limpieza = new pg.Pool({ connectionString: URL_TEST, max: 1 });
await limpieza.query("DROP TABLE IF EXISTS archivos, borrados, cache_tmdb");
await limpieza.end();

const A = 5191, B = 5192;

try {
  await levantar(A);
  await levantar(B);

  seccion("1. Las dos hablan con la misma base");
  const sA = await pedir(A, "/api/sesion");
  const sB = await pedir(B, "/api/sesion");
  ok(sA.json.conLogin === true && sB.json.conLogin === true, "las dos piden cuenta");

  seccion("2. Una cuenta creada en A sirve para entrar en B");
  const reg = await pedir(A, "/api/registro", {
    method: "POST",
    body: JSON.stringify({ email: "prueba@ejemplo.com", pass: "unaClaveLarga123" }),
  });
  ok(reg.status === 200, "se registra en A");

  const enB = await pedir(B, "/api/estado");
  ok(enB.status === 200, "y la MISMA cookie entra en B sin volver a loguearse");
  ok(enB.json.cuenta?.email === "prueba@ejemplo.com", "B reconoce de quién es la sesión");

  const perfil = enB.json.usuario;
  ok(!!perfil, "B ve el perfil que A creó al registrar (" + perfil + ")");

  seccion("3. Puntúo en A y lo veo en B");
  const antesB = (await pedir(B, "/api/estado")).json.cantidad;
  await pedir(A, "/api/puntuar", {
    method: "POST",
    body: JSON.stringify({
      key: "movie:603", kind: "movie", tmdbId: 603,
      titulo: "Matrix", anio: 1999, rating: 9,
    }),
  });
  const despuesB = (await pedir(B, "/api/estado")).json;
  ok(despuesB.cantidad === antesB + 1,
     "B ve la puntuación de A sin reiniciar ni tocar nada (" + antesB + " -> " + despuesB.cantidad + ")");
  ok(despuesB.pelis === 1, "y la cuenta como película");

  seccion("4. Y al revés: puntúo en B y lo veo en A");
  await pedir(B, "/api/puntuar", {
    method: "POST",
    body: JSON.stringify({
      key: "tv:1396", kind: "tv", tmdbId: 1396,
      titulo: "Breaking Bad", anio: 2008, rating: 10,
    }),
  });
  const despuesA = (await pedir(A, "/api/estado")).json;
  ok(despuesA.cantidad === 2, "A ve las dos");
  ok(despuesA.series === 1, "y la serie llegó como serie");

  seccion("5. Despuntuar también viaja");
  await pedir(A, "/api/despuntuar", {
    method: "POST", body: JSON.stringify({ key: "movie:603" }),
  });
  ok((await pedir(B, "/api/estado")).json.cantidad === 1, "B se entera de que A la borró");

  seccion("6. Un perfil nuevo en B aparece en A");
  await pedir(B, "/api/usuarios", {
    method: "POST", body: JSON.stringify({ nombre: "Papá" }),
  });
  const listaA = (await pedir(A, "/api/estado")).json.usuarios || [];
  ok(listaA.some(u => u.nombre === "Papá"), "A ve el perfil que se creó en B");

  seccion("7. Borrar un perfil en A se lo lleva en B (la lápida)");
  const papa = listaA.find(u => u.nombre === "Papá");
  await pedir(A, "/api/usuarios/borrar", {
    method: "POST", body: JSON.stringify({ id: papa.id }),
  });
  const listaB = (await pedir(B, "/api/estado")).json.usuarios || [];
  ok(!listaB.some(u => u.id === papa.id), "en B ya no está");

  seccion("8. Sin HOST, el puerto NO se asoma a la red");

  // El default tiene que ser el lado cerrado: en tu compu la app abre tus datos
  // y no todas las redes son la de tu casa. Se levanta una tercera sin HOST y
  // se golpea por la IP de la red, que es por donde entraría el de al lado.
  const C = 5193;
  const sinHost = spawn(process.execPath, ["server.mjs"], {
    env: (() => { const e = entorno(C); delete e.HOST; return e; })(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  procesos.push(sinHost);
  let salida = "";
  sinHost.stdout.on("data", d => { salida += d; });
  await new Promise((r, rej) => {
    const limite = setTimeout(() => rej(new Error("no arrancó la tercera")), 30000);
    sinHost.stdout.on("data", d => { if (/Qué Ver/.test(String(d))) { clearTimeout(limite); setTimeout(r, 500); } });
  });

  ok(/sólo esta compu/.test(salida), "lo dice al arrancar: «sólo esta compu»");
  ok(!/en el celular/.test(salida), "y no ofrece una dirección de red que no abre");

  const { networkInterfaces } = await import("node:os");
  const ipLan = Object.values(networkInterfaces()).flat()
    .find(i => i && i.family === "IPv4" && !i.internal)?.address;

  if (!ipLan) {
    console.log("  --  sin IP de red en esta máquina, no se puede probar de afuera");
  } else {
    let alcanzable = false;
    try {
      const ctl = AbortSignal.timeout(3000);
      await fetch("http://" + ipLan + ":" + C + "/api/sesion", { signal: ctl });
      alcanzable = true;
    } catch { alcanzable = false; }
    ok(!alcanzable, "desde " + ipLan + " (la red) el puerto no contesta");
  }

  // Y con HOST=0.0.0.0 puesto a mano sí abre, que es lo que necesita Render:
  // si esto se rompiera, el health check no llegaría y el servicio se cae.
  ok(/abierto a la red/.test(
    await new Promise((r) => {
      const abierto = spawn(process.execPath, ["server.mjs"], {
        env: { ...entorno(5194), HOST: "0.0.0.0" }, stdio: ["ignore", "pipe", "pipe"],
      });
      procesos.push(abierto);
      let t = "";
      abierto.stdout.on("data", d => { t += d; if (/Qué Ver/.test(t)) setTimeout(() => r(t), 400); });
    })
  ), "con HOST=0.0.0.0 sí se abre (es lo que usa Render)");

} finally {
  for (const p of procesos) { try { p.kill(); } catch { /* ya estaba */ } }
}

console.log("\n" + (fallos
  ? `  ${fallos} de ${hechos} FALLARON\n`
  : `  Todo verde (${hechos}).\n`));
process.exit(fallos ? 1 : 0);
