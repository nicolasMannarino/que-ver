// Sube la tabla de vecinas (data/vecinas.json.gz) a la base, para que la use la app
// publicada: Render no tiene data/ propio, y la tabla no puede ir al repo porque
// sale de MovieLens, que no se redistribuye.
//
//   python armar-vecinas.py <carpeta ml-32m>      (una vez, arma el archivo)
//   node --env-file=.env subir-vecinas.mjs
//
// La app la lee al arrancar: después de subirla hay que reiniciar el servicio.
import fs from "node:fs";
import zlib from "node:zlib";
import * as A from "./almacen.mjs";
import * as V from "./vecinas.mjs";

if (!process.env.DATABASE_URL) {
  console.log("Falta DATABASE_URL. Corrélo así:  node --env-file=.env subir-vecinas.mjs");
  process.exit(1);
}
if (!fs.existsSync(V.ARCHIVO)) {
  console.log("No está " + V.ARCHIVO + ". Primero:  python armar-vecinas.py <carpeta ml-32m>");
  process.exit(1);
}
const doc = JSON.parse(zlib.gunzipSync(fs.readFileSync(V.ARCHIVO)).toString("utf8"));
V.usar(doc);                                   // si está rota, explota acá y no sube nada
console.log(`tabla: ${doc.tmdb.length} películas, MovieLens hasta ${doc.hasta}`);

await A.abrir();
await A.cacheEscribir(V.CLAVE, doc);
// cacheEscribir se traga los errores (el cache es best-effort): la prueba de que
// subió es leerla de vuelta.
const vuelta = await A.cacheLeer(V.CLAVE);
const ok = vuelta?.triangulo === doc.triangulo;
console.log(ok ? "listo: está en la base. Reiniciá el servicio para que la lea."
               : "FALLÓ: no la pude leer de vuelta de la base.");
await A.cerrar();
process.exit(ok ? 0 : 1);
