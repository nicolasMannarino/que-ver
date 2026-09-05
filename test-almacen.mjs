// Que dos instancias contra la misma base no se pisen.
//
// Esto es lo único que hace que la app de tu compu y la publicada sean la misma
// app y no dos que se parecen. El resto de los tests corren sin red; éste NO
// puede: la mitad de lo que hay que probar es SQL, y un Postgres de mentira que
// yo escriba iba a estar de acuerdo conmigo justo en lo que me equivoque.
//
//   docker run -d --name qv-pg -e POSTGRES_PASSWORD=qv -p 5433:5432 postgres:16
//   TEST_DATABASE_URL=postgres://postgres:qv@localhost:5433/postgres node test-almacen.mjs
//
// Sin TEST_DATABASE_URL se saltea y lo dice. Nunca corre contra la base de
// verdad: ver la guarda de abajo.
import process from "node:process";

const URL_TEST = process.env.TEST_DATABASE_URL;

if (!URL_TEST) {
  console.log("\n  test-almacen: SALTEADO (falta TEST_DATABASE_URL)\n" +
              "  Levantá uno descartable:\n" +
              "    docker run -d --name qv-pg -e POSTGRES_PASSWORD=qv -p 5433:5432 postgres:16\n");
  process.exit(0);
}

// Este test BORRA las tablas antes de cada corrida. Contra la base de la app
// eso sería perder todo, así que se exige que sea una base de juguete y no se
// acepta la variable de producción ni por descuido.
if (/neon\.tech|render\.com|amazonaws/i.test(URL_TEST)) {
  console.error("\n  test-almacen: TEST_DATABASE_URL apunta a una base alojada.\n" +
                "  Este test borra las tablas. Usá una descartable.\n");
  process.exit(1);
}
if (process.env.DATABASE_URL && process.env.DATABASE_URL === URL_TEST) {
  console.error("\n  test-almacen: TEST_DATABASE_URL es la MISMA que DATABASE_URL. No.\n");
  process.exit(1);
}

let fallos = 0, hechos = 0;
const ok = (cond, que) => {
  hechos++;
  if (cond) console.log("  ok  " + que);
  else { fallos++; console.log("  NO  " + que); }
};
const seccion = (t) => console.log("\n--- " + t + " ---");

// El módulo lee DATABASE_URL del entorno al abrir, así que se la ponemos.
process.env.DATABASE_URL = URL_TEST;
process.env.DATABASE_SSL_SIN_VERIFICAR = "1";   // postgres local, sin certificado

// Dos instancias = dos copias del módulo con su propia memoria. Importarlo dos
// veces con un query distinto en la URL es lo que las hace independientes, que
// es justo el escenario que hay que probar: Render y tu compu.
const A = await import("./almacen.mjs");
const B = await import("./almacen.mjs?instancia=2");

// --- Limpieza -------------------------------------------------------------
const { default: pg } = await import("pg");
const limpieza = new pg.Pool({ connectionString: URL_TEST, max: 1 });
await limpieza.query("DROP TABLE IF EXISTS archivos, borrados, cache_tmdb");

await A.abrir();
await B.abrir();

try {
  seccion("1. Lo que escribe una, la otra lo ve");

  A.escribir("usuarios/nico/puntuaciones.json", [{ key: "movie:1", rating: 9 }]);
  await A.drenar();

  ok(B.leer("usuarios/nico/puntuaciones.json", null) === undefined ||
     B.leer("usuarios/nico/puntuaciones.json", null) === null,
     "antes de refrescar, B todavía no lo ve (memoria vieja)");

  let cambios = await B.refrescar();
  ok(cambios.has("usuarios/nico/puntuaciones.json"), "refrescar avisa QUÉ clave cambió");
  ok(B.leer("usuarios/nico/puntuaciones.json", null)?.[0]?.rating === 9,
     "y B ahora lee el 9 que puso A");

  seccion("2. Ida y vuelta: las dos direcciones");

  B.escribir("usuarios/nico/puntuaciones.json", [{ key: "movie:1", rating: 9 }, { key: "movie:2", rating: 7 }]);
  await B.drenar();
  await A.refrescar();
  ok(A.leer("usuarios/nico/puntuaciones.json", []).length === 2,
     "lo que puntuó B vuelve a A");

  seccion("3. Refrescar no pisa lo que todavía está en la cola");

  // El caso feo: A escribe y ANTES de que la escritura aterrice, refresca. Si
  // refrescar leyera la base sin esperar la cola, se traería la fila vieja y le
  // borraría a A su propio cambio recién hecho.
  A.escribir("usuarios/nico/estado.json", { vistas: ["tv:1"] });
  const traido = await A.refrescar();          // sin await drenar() a propósito
  ok(A.leer("usuarios/nico/estado.json", null)?.vistas?.[0] === "tv:1",
     "el cambio propio sobrevive a un refrescar inmediato");
  ok(traido !== null, "y el refresco igual devolvió algo");

  seccion("4. Borrar un perfil se propaga");

  A.escribir("usuarios/papa/puntuaciones.json", [{ key: "movie:9", rating: 5 }]);
  await A.drenar();
  await B.refrescar();
  ok(B.leer("usuarios/papa/puntuaciones.json", null) !== null, "B ve el perfil nuevo");

  A.borrarPrefijo("usuarios/papa/");
  await A.drenar();
  cambios = await B.refrescar();
  ok(B.leer("usuarios/papa/puntuaciones.json", null) === undefined ||
     B.leer("usuarios/papa/puntuaciones.json", null) === null,
     "y cuando A lo borra, a B también se le va");
  ok(cambios.has("usuarios/papa/puntuaciones.json"), "el borrado avisa la clave");

  seccion("5. Borrar y volver a crear: gana lo último");

  A.escribir("usuarios/papa/puntuaciones.json", [{ key: "movie:9", rating: 6 }]);
  await A.drenar();
  await B.refrescar();
  const revivida = B.leer("usuarios/papa/puntuaciones.json", null);
  ok(revivida?.[0]?.rating === 6,
     "la clave revive: la lápida no se la lleva puesta de nuevo");

  seccion("6. Una clave sin tocar no viaja dos veces");

  const antes = await B.refrescar();
  ok(antes.size === 0, "sin cambios, refrescar no trae nada");

  seccion("7. La fila que commitea tarde no se pierde");

  // El bug que casi se va a producción. now() en Postgres es la hora en que
  // ARRANCÓ la transacción, no la del commit: una fila escrita con fecha T1 y
  // commiteada después de que la otra instancia tomara su marca en T2 > T1 no
  // vuelve a aparecer nunca en un "dame lo posterior a T2". Se reproduce a mano
  // porque el escenario necesita una transacción abierta a propósito.
  const tardia = new pg.Pool({ connectionString: URL_TEST, max: 1 });
  const con = await tardia.connect();
  try {
    await con.query("BEGIN");
    await con.query(
      "INSERT INTO archivos (clave, valor, actualizado) VALUES ($1, $2, now()) " +
      "ON CONFLICT (clave) DO UPDATE SET valor = $2, actualizado = now()",
      ["usuarios/nico/preferencias.json", JSON.stringify({ vara: 0.7 })]);

    // B toma su marca mientras la transacción sigue abierta: no ve nada.
    const enElMedio = await B.refrescar();
    ok(!enElMedio.has("usuarios/nico/preferencias.json"),
       "mientras no commitea, B no la ve (correcto)");

    await con.query("COMMIT");
  } finally {
    con.release();
    await tardia.end();
  }

  const despues = await B.refrescar();
  ok(despues.has("usuarios/nico/preferencias.json"),
     "y apenas commitea, B SÍ la ve (la ventana de solapamiento la rescata)");
  ok(B.leer("usuarios/nico/preferencias.json", null)?.vara === 0.7,
     "con el contenido correcto");

  seccion("8. No se retrae el mismo contenido dos veces");

  await B.refrescar();
  const otraVez = await B.refrescar();
  ok(otraVez.size === 0,
     "una clave que ya se aplicó no vuelve a contarse como cambio");

  seccion("9. Escribir de a dos no se lleva puesto el cambio del otro");

  // El caso que importa es cuentas.json: TODAS las cuentas en una fila, y cada
  // cambio la reescribe entera desde una lectura que puede estar vieja. Con
  // escribir() el último gana y el otro cambio desaparece sin error. Acá se
  // simula lo peor: las dos instancias leen, las dos modifican campos
  // distintos, y recién ahí las dos escriben.

  A.escribir("cuentas.json", [{ id: "u1", v: 1, tmdbKey: "", email: "a@b.c" }]);
  await A.drenar();
  await B.refrescar();

  // A sube la versión de sesión ("cerrar sesión en todos lados").
  A.mutar("cuentas.json", (l) => {
    const c = l.find(x => x.id === "u1");
    if (c) c.v = (c.v || 1) + 1;
    return l;
  }, []);

  // B, sin haber visto eso, guarda una API key sobre SU copia vieja.
  B.mutar("cuentas.json", (l) => {
    const c = l.find(x => x.id === "u1");
    if (c) c.tmdbKey = "cifrada-nueva";
    return l;
  }, []);

  await A.drenar();
  await B.drenar();
  await A.refrescar();
  await B.refrescar();

  const finalA = A.leer("cuentas.json", [])[0];
  ok(finalA.v === 2, "el cierre de sesión de A quedó (v=" + finalA.v + ", no volvió a 1)");
  ok(finalA.tmdbKey === "cifrada-nueva", "y la key que guardó B también");

  seccion("10. Un perfil con id tomado no se le agrega a la otra cuenta");

  // Si el id ya existe en la base, crearUsuario NO agrega la entrada: sin
  // entrada, usuarioDe() no le autoriza ese perfil a la cuenta, que es lo que
  // evita que dos cuentas terminen escribiendo las puntuaciones de la misma.
  A.escribir("usuarios.json", [{ id: "papa", nombre: "Papá", cuenta: "cuenta-A" }]);
  await A.drenar();
  await B.refrescar();

  B.mutar("usuarios.json",
    (l) => (l.some(u => u.id === "papa") ? l : [...l, { id: "papa", nombre: "Papá", cuenta: "cuenta-B" }]),
    []);
  await B.drenar();
  await A.refrescar();

  const lista = A.leer("usuarios.json", []);
  ok(lista.length === 1, "no quedaron dos entradas con el mismo id");
  ok(lista[0].cuenta === "cuenta-A", "y sigue siendo de la cuenta que lo creó primero");

  seccion("11. El cache de TMDB sigue andando");

  A.cacheEscribir("ficha:movie:1", { titulo: "algo", peso: 1 });
  await new Promise(r => setTimeout(r, 300));
  const leida = await B.cacheLeer("ficha:movie:1");
  ok(leida?.titulo === "algo", "una instancia escribe el cache y la otra lo lee");

} finally {
  await A.cerrar().catch(() => {});
  await B.cerrar().catch(() => {});
  await limpieza.end().catch(() => {});
}

console.log("\n" + (fallos
  ? `  ${fallos} de ${hechos} FALLARON\n`
  : `  Todo verde (${hechos}).\n`));
process.exit(fallos ? 1 : 0);
