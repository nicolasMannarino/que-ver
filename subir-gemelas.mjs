// Sube el panel de gemelas (data/gemelas.json.gz) a la base, para que la use la app
// publicada: Render no tiene data/ propio, y el panel no puede ir al repo porque
// sale de MovieLens, que no se redistribuye.
//
//   python armar-gemelas.py <carpeta ml-32m>      (una vez, arma el archivo)
//   node --env-file=.env subir-gemelas.mjs
//
// La app la lee al arrancar: después de subirla hay que reiniciar el servicio.
import fs from "node:fs";
import zlib from "node:zlib";
import * as A from "./almacen.mjs";
import * as G from "./gemelas.mjs";

if (!process.env.DATABASE_URL) {
  console.log("Falta DATABASE_URL. Corrélo así:  node --env-file=.env subir-gemelas.mjs");
  process.exit(1);
}
if (!fs.existsSync(G.ARCHIVO)) {
  console.log("No está " + G.ARCHIVO + ". Primero:  python armar-gemelas.py <carpeta ml-32m>");
  process.exit(1);
}
const doc = JSON.parse(zlib.gunzipSync(fs.readFileSync(G.ARCHIVO)).toString("utf8"));
G.usar(doc);                                   // si está roto, explota acá y no sube nada
console.log(`panel: ${doc.personas} personas, ${doc.tmdb.length} películas, MovieLens hasta ${doc.hasta}`);

await A.abrir();
await A.cacheEscribir(G.CLAVE, doc);
// cacheEscribir se traga los errores (el cache es best-effort): la prueba de que
// subió es leerla de vuelta.
const vuelta = await A.cacheLeer(G.CLAVE);
const cuerpo = (d) => d?.quien ?? null;
const ok = cuerpo(vuelta) !== null && cuerpo(vuelta) === cuerpo(doc);
console.log(ok ? "listo: está en la base. Reiniciá el servicio para que la lea."
               : "FALLÓ: no la pude leer de vuelta de la base.");
await A.cerrar();
process.exit(ok ? 0 : 1);
