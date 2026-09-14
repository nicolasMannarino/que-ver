// ¿El motor predice SU gusto, o solo devuelve cosas parecidas?
// Prueba honesta: para cada película que él puntuó, armo el perfil SIN ella y
// veo qué puntaje le habría dado. Si el motor sirve, las que puntuó 9-10 tienen
// que quedar arriba de las que puntuó 4-6.
//
//   node backtest.mjs [usuario]
import fs from "node:fs";
import * as T from "./tmdb.mjs";
import * as M from "./motor.mjs";
import * as D from "./datos.mjs";
import * as V from "./vecinas.mjs";

const usuario = process.argv[2] || D.listarUsuarios()[0]?.id;
// "config.json" es la CLAVE del almacén, no una ruta: leer() ya la resuelve
// contra data/. Pasándole la ruta completa quedaba data/C:/.../data/config.json,
// que no existe, y sin key fichas() devolvía cero: el backtest venía imprimiendo
// NaN en vez de medir nada.
T.setKey(process.env.TMDB_API_KEY?.trim() || D.leer("config.json", {}).tmdbKey);

const puntuadas = D.cargar(usuario);
if (!puntuadas.length) { console.log("Ese perfil no tiene puntuaciones."); process.exit(1); }

console.log(`\nBacktest de "${usuario}" — ${puntuadas.length} títulos\n`);
const vistas = await M.fichas(puntuadas);

// La afinidad la trae el motor, para que esto mida exactamente lo que corre
const afinidad = (perfil, v) => M.afinidad(perfil, v.features, v.nota);

const filas = [];
for (let i = 0; i < vistas.length; i++) {
  const sinEsta = vistas.filter((_, j) => j !== i);   // leave-one-out
  const p = M.perfil(sinEsta);
  filas.push({ titulo: vistas[i].titulo || vistas[i].d?.title, real: vistas[i].rating, pred: afinidad(p, vistas[i]) });
}

// Spearman: ¿el orden que predice se parece al orden real?
function spearman(xs, ys) {
  const rank = (arr) => {
    const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(arr.length);
    for (let i = 0; i < idx.length;) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const medio = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = medio;
      i = j + 1;
    }
    return r;
  };
  const a = rank(xs), b = rank(ys);
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}

const rho = spearman(filas.map(f => f.real), filas.map(f => f.pred));

// ¿Separa lo que le gustó de lo que no? AUC = probabilidad de que una que le
// gustó quede arriba de una que no, tomadas al azar. 0.5 = tirar una moneda.
const buenas = filas.filter(f => f.real >= 8);
const malas = filas.filter(f => f.real <= 6);
let gana = 0, empate = 0;
for (const b of buenas) for (const m of malas) {
  if (b.pred > m.pred) gana++; else if (b.pred === m.pred) empate++;
}
const auc = (gana + empate / 2) / (buenas.length * malas.length);

const prom = (xs) => xs.reduce((s, v) => s + v.pred, 0) / (xs.length || 1);

console.log(`  Correlación de orden (Spearman): ${rho.toFixed(3)}`);
console.log(`     0 = no predice nada · 1 = orden perfecto`);
console.log(`\n  Separa 8-10 de 1-6 (AUC): ${auc.toFixed(3)}   [${buenas.length} buenas vs ${malas.length} flojas]`);
console.log(`     0.50 = una moneda · 0.70 = útil · 0.80+ = bueno`);
console.log(`\n  Afinidad promedio de las que puntuó 8-10: ${prom(buenas).toFixed(3)}`);
console.log(`  Afinidad promedio de las que puntuó 1-6:  ${prom(malas).toFixed(3)}`);

const ord = [...filas].sort((a, b) => b.pred - a.pred);
console.log(`\n  Las 8 con más afinidad (y qué les puso él de verdad):`);
for (const f of ord.slice(0, 8)) console.log(`     ${f.pred.toFixed(2)}  → él le puso ${String(f.real).padStart(2)}   ${f.titulo}`);
console.log(`\n  Las 6 con menos afinidad:`);
for (const f of ord.slice(-6)) console.log(`     ${f.pred.toFixed(2)}  → él le puso ${String(f.real).padStart(2)}   ${f.titulo}`);

console.log(`\n  Los errores más grandes (el motor se equivocó feo):`);
const media = filas.reduce((s, f) => s + f.real, 0) / filas.length;
const sorpresas = [...filas].sort((a, b) => Math.abs(b.real - media) * -Math.sign(b.pred) - Math.abs(a.real - media) * -Math.sign(a.pred));
const falsosPositivos = ord.slice(0, 40).filter(f => f.real <= 6).slice(0, 4);
const falsosNegativos = ord.slice(-40).filter(f => f.real >= 9).slice(0, 4);
for (const f of falsosPositivos) console.log(`     le habría gustado (afinidad alta) pero él le puso ${f.real}: ${f.titulo}`);
for (const f of falsosNegativos) console.log(`     lo habría descartado pero él le puso ${f.real}: ${f.titulo}`);

// Y con la gente que puntúa como vos, que es lo que ordena en la app cuando hay tabla.
// Mismo dejar-una-afuera; lo marcado «no tener en cuenta» no entra, igual que al calibrar.
await V.cargar();
if (V.disponible()) {
  const cuentan = vistas.filter(v => !M.noCuenta(v));
  const { loo, params } = M.prepararMezcla(cuentan);
  const soloMotor = M.afinidadesSinCadaUna(cuentan);
  const aucDe = (pred) => {
    let g = 0, e = 0, nb = 0, nm = 0;
    cuentan.forEach((b, i) => { if (b.rating < 8) return; nb++;
      cuentan.forEach((m, j) => { if (m.rating > 6) return; if (pred[i] > pred[j]) g++; else if (pred[i] === pred[j]) e++; }); });
    cuentan.forEach(m => { if (m.rating <= 6) nm++; });
    return (g + e / 2) / (nb * nm);
  };
  const arriba = (pred) => {
    const top = cuentan.map((v, i) => [pred[i], v.rating]).sort((a, b) => b[0] - a[0]).slice(0, 10).map(x => x[1]);
    return `${top.filter(r => r >= 8).length} con 8+, ${top.filter(r => r >= 7).length} con 7+, ${top.filter(r => r <= 6).length} con 6 o menos`;
  };
  console.log(`\n  Con la gente que puntúa como vos (${V.info().peliculas} películas de MovieLens):`);
  if (!params) console.log("     muy pocas de tus películas están en la tabla: sigue solo el motor");
  else {
    console.log(`     AUC motor solo: ${aucDe(soloMotor).toFixed(3)} · mezclado: ${aucDe(loo).toFixed(3)}`);
    console.log(`     las 10 de más arriba — motor solo: ${arriba(soloMotor)}`);
    console.log(`                            mezclado:   ${arriba(loo)}`);
  }
}
console.log();
