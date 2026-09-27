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
// Y sus reglas declaradas, que son las que la app aplica encima de la afinidad
const prefs = { ...D.PREFS_POR_DEFECTO, ...D.leer(D.rutasDe(usuario).preferencias, {}) };

const filas = [];
for (let i = 0; i < vistas.length; i++) {
  const v = vistas[i];
  const sinEsta = vistas.filter((_, j) => j !== i);   // leave-one-out
  const p = M.perfil(sinEsta);
  // Como la ve la app: con fecha y con la ficha colgada de `detalle`, para que
  // filtrar() y preferencias() lean lo mismo que leen en una búsqueda de verdad.
  const cand = { ...v, fecha: v.d.release_date || v.d.first_air_date || "", detalle: v };
  // Con los años de lo que vio: la regla de las viejas mira si tiene experiencia
  // con esa época, y sin pasárselos el backtest mediría otra cosa que la app.
  const pref = M.preferencias(cand, prefs, p.perfilesMotivo, p.anios);
  filas.push({
    titulo: v.titulo || v.d?.title, real: v.rating, pred: afinidad(p, v),
    conf: afinidad(p, v) + 0.5 * pref.ajuste,   // lo mismo que puntuar() pone en c.confianza
    pasa: M.filtrar([cand], p, prefs).length > 0,
    // lo que mira diversificar(): género, la suya a la que se parece, y la saga
    generos: v.generos, detalle: v, masParecidaTuya: M.afinidadVecinos(p, v.features, 20, true),
  });
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

// --- Precisión arriba de todo ---
// El AUC mide el orden entero; lo que él ve son las primeras diez. Esto ordena por
// confianza —afinidad más sus reglas, igual que la app— sobre lo que filtrar() dejaría
// pasar, y cuenta cuántas de arriba puntuó 7 o más.
//
// No es un "acierto": el pool son SUS películas, que ya eligió ver. Hay que leerlo
// contra el base rate. El acierto de verdad está en «Mis aciertos», con lo que puntuó
// DESPUÉS de que la app se la recomendara.
// Lo que él sacó del perfil tampoco se cuenta acá: no representa su gusto de hoy.
// Y se diversifica como en la app, porque si no el tope son sus ocho animes seguidos
// y eso es una lista que nunca vería.
const enLista = M.diversificar(
  filas.filter(f => f.pasa && !M.noCuenta(f.detalle)).sort((a, b) => b.conf - a.conf), 30);
const precision = (k) => {
  const top = enLista.slice(0, k);
  return top.length ? top.filter(f => f.real >= 7).length / top.length : NaN;
};
const pct = (x) => (x * 100).toFixed(0) + "%";
const conPool = filas.filter(f => f.pasa && !M.noCuenta(f.detalle));
const baseRate = conPool.filter(f => f.real >= 7).length / (conPool.length || 1);
console.log("");
console.log("  De las que pondría primeras, cuántas puntuó 7 o más:");
console.log(`     P@10: ${pct(precision(10))} · P@20: ${pct(precision(20))} · P@30: ${pct(precision(30))}`);
console.log(`     base rate: ${pct(baseRate)} sobre ${conPool.length} que pasan tus varas — abajo de eso, ordenar resta`);

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

// --- ¿Y contra el catálogo? ---
// Todo lo de arriba ordena SUS títulos: cosas que él ya eligió ver, donde el 64% le
// gustó. El pool de verdad es el catálogo, donde casi nada le va a encantar. Por eso
// el backtest decía P@10 90% mientras él, mirando 6 tarjetas: *"quizás me gusta 1 o
// 2"*. No se estaba midiendo lo que pasa en la app.
//
// Acá se le suman negativos muestreados —títulos conocidos que no puntuó— y se ordena
// todo junto con lo mismo que ordena la app. No sabemos que no le gustarían (alguno
// sí), así que la precisión de este pool es una COTA DE ABAJO, no la precisión. Lo que
// sí mide honesto es el orden: si sus 9-10 no le ganan a un título cualquiera del
// catálogo, ordenar no sirve para nada.
//
//   NEGATIVOS=0 node backtest.mjs      para saltearlo
//   NEGATIVOS=600 node backtest.mjs    para apretar más
const N_NEG = parseInt(process.env.NEGATIVOS ?? "300", 10);

// El mismo sorteo en cada corrida: si el pool cambia, dos medidas no se pueden comparar.
let semilla = 20260920;
const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648);

async function muestraDelCatalogo(n, excluir) {
  // Páginas sorteadas de todo el catálogo por votos, no las primeras: las 100 más
  // votadas de la historia son todas buenas y conocidas, y eso no es el catálogo, es
  // otra lista de favoritas. La página 60 ya está en ~2.000 votos, que es más o menos
  // donde vive lo que el motor puede llegar a proponer.
  const paginas = [], puestas = new Set();
  while (paginas.length < Math.ceil(n / 12)) {
    const kind = azar() < 0.8 ? "movie" : "tv";       // 80/20, como su lista
    const pag = 1 + Math.floor(azar() * (kind === "movie" ? 60 : 30));
    const k = kind + ":" + pag;
    if (puestas.has(k)) continue;
    puestas.add(k);
    paginas.push({ kind, pag });
  }
  const listas = await T.pool(paginas, 8, ({ kind, pag }) =>
    T.descubrir(kind, { sort_by: "vote_count.desc", page: String(pag) }));
  const out = [];
  listas.forEach((l, i) => {
    for (const c of (l?.results || [])) {
      const key = paginas[i].kind + ":" + c.id;
      if (excluir.has(key)) continue;
      excluir.add(key);
      out.push({ key, kind: paginas[i].kind, tmdbId: c.id, titulo: c.title || c.name });
    }
  });
  for (let i = out.length - 1; i > 0; i--) {          // barajar y cortar
    const j = Math.floor(azar() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.slice(0, n);
}

if (N_NEG > 0) {
  const cuentan = vistas.filter(v => !M.noCuenta(v));
  const p = M.perfil(cuentan);
  p.mezcla = M.prepararMezcla(cuentan);
  const negativos = await M.fichas(await muestraDelCatalogo(N_NEG, new Set(vistas.map(v => v.key))));

  // Lo mismo que arma puntuar(): afinidad mezclada con las vecinas, más sus reglas.
  // Las suyas van con la predicción SIN su propia nota; las del catálogo no tienen
  // nota que sacar, así que la desventaja es de ellas. La medida queda conservadora.
  const armar = (v, suya, predada) => {
    const cand = { ...v, fecha: v.d.release_date || v.d.first_air_date || "", detalle: v };
    const pref = M.preferencias(cand, prefs, p.perfilesMotivo, p.anios);
    let afin = predada;
    if (afin == null) {
      const motor = M.afinidad(p, v.features, v.nota);
      const vec = p.mezcla.params && v.kind === "movie" ? V.predecir(p.mezcla.pv, v.tmdbId) : null;
      afin = vec ? M.mezclar(p.mezcla.params, motor, vec.puntaje) : motor;
    }
    return {
      titulo: v.titulo || v.d?.title || v.d?.name, suya, real: v.rating ?? null,
      conf: afin + 0.5 * pref.ajuste, pasa: M.filtrar([cand], p, prefs).length > 0,
      generos: v.generos, detalle: v, masParecidaTuya: M.afinidadVecinos(p, v.features, 20, true),
    };
  };
  const pool = [
    ...cuentan.map((v, i) => armar(v, true, p.mezcla.loo[i])),
    ...negativos.map(v => armar(v, false, null)),
  ];

  const suyas9 = (f) => f.suya && f.real >= 9;
  const suyasFlojas = (f) => f.suya && f.real <= 6;
  const delCatalogo = (f) => !f.suya;
  const aucContra = (esA, esB) => {
    const A = pool.filter(esA), B = pool.filter(esB);
    let g = 0, e = 0;
    for (const a of A) for (const b of B) { if (a.conf > b.conf) g++; else if (a.conf === b.conf) e++; }
    return A.length && B.length ? (g + e / 2) / (A.length * B.length) : NaN;
  };

  console.log(`  --- Pool realista: ${cuentan.length} suyas + ${negativos.length} del catálogo que no puntuó ---`);
  console.log(`  AUC de sus 9-10 contra...`);
  console.log(`     sus propias 1-6:         ${aucContra(suyas9, suyasFlojas).toFixed(3)}   <- lo que mide el backtest de arriba`);
  console.log(`     el catálogo que no vio:  ${aucContra(suyas9, delCatalogo).toFixed(3)}   <- lo que de verdad hace la app`);

  // Y cómo queda la lista que te mostraría: filtrada y diversificada, igual que la app.
  const lista = M.diversificar(pool.filter(f => f.pasa).sort((a, b) => b.conf - a.conf), 30);
  console.log(`\n  De las primeras que mostraría (${pool.filter(f => f.pasa).length} pasan tus varas):`);
  for (const k of [10, 20, 30]) {
    const t = lista.slice(0, k);
    const c = (fn) => String(t.filter(fn).length).padStart(2);
    console.log(`     top ${String(k).padStart(2)}:  ${c(suyas9)} suyas 9-10 · ${c(f => f.suya && f.real >= 7 && f.real <= 8)} suyas 7-8 · ${c(suyasFlojas)} suyas 1-6 · ${c(delCatalogo)} del catálogo`);
  }

  const orden = [...pool].sort((a, b) => b.conf - a.conf);
  const puestos9 = orden.map((f, i) => (suyas9(f) ? i + 1 : 0)).filter(Boolean);
  const mediana = puestos9[Math.floor(puestos9.length / 2)];
  console.log(`\n  Sus ${puestos9.length} notas 9-10 caen, en mediana, en el puesto ${mediana} de ${pool.length}.`);
  console.log(`     arriba de ahí hay ${orden.slice(0, mediana).filter(delCatalogo).length} del catálogo: esas son las apuestas fuertes.`);

  // Cuántas del catálogo pasan su vara: es el techo de cuán larga puede ser la lista
  // antes de empezar a rellenar. Sobre las sorteadas dice cuántas, por cada 300 que
  // haya ahí afuera, vale la pena ir a buscar.
  const vara = prefs.confianzaMinima ?? 0;
  const pasanVara = pool.filter(f => delCatalogo(f) && f.pasa && f.conf >= vara).length;
  console.log(`\n  Con tu vara en ${vara}: ${pasanVara} de las ${negativos.length} del catálogo la pasan.`);

  // Ordenadas por confianza, no por el orden en que las deja diversificar(): acá
  // interesa en qué apuesta el motor, no cómo se reparten en la pantalla.
  console.log(`\n  Las 10 del catálogo que pondría primeras (lo que verías en la app):`);
  for (const x of orden.filter(y => delCatalogo(y) && y.pasa).slice(0, 10)) {
    console.log(`     ${x.conf.toFixed(2)}  ${x.titulo}`);
  }
  console.log();
}
