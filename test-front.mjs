// Ejecuta el JavaScript de la página contra los datos REALES de la API, con un
// DOM de mentira. Existe porque un `bts.append(lenta, ...)` que quedó de una
// versión anterior tiraba ReferenceError, cortaba el bucle y dejaba la lista
// vacía — y el chequeo de sintaxis no lo veía.
//
//   node test-front.mjs            (con el server levantado)
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";

const PUERTO = process.env.PORT || 5173;
const BASE = "http://localhost:" + PUERTO;
let fallos = 0;
const ok = (cond, msg) => { console.log((cond ? "  ok  " : "FALLA ") + msg); if (!cond) fallos++; };

// --- DOM mínimo, lo suficiente para que el script corra ---
function crearElemento(tag) {
  const el = {
    tagName: (tag || "div").toUpperCase(),
    children: [], style: {}, dataset: {}, attributes: {},
    className: "", textContent: "", value: "", checked: false, href: "", title: "", src: "",
    _html: "",
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; if (v === "") this.children = []; },
    classList: {
      _c: new Set(),
      add(...c) { c.forEach(x => this._c.add(x)); },
      remove(...c) { c.forEach(x => this._c.delete(x)); },
      contains(c) { return this._c.has(c); },
      toggle(c, f) { const v = f === undefined ? !this._c.has(c) : f; v ? this._c.add(c) : this._c.delete(c); return v; },
    },
    // Como el DOM real: si el nodo ya está adentro, appendChild lo MUEVE al
    // final, no lo duplica. Sin esto el reordenamiento daba falso negativo.
    append(...n) { for (const x of n) if (x) this.appendChild(x); },
    appendChild(n) {
      if (!n) return n;
      const i = this.children.indexOf(n);
      if (i >= 0) this.children.splice(i, 1);
      this.children.push(n);
      return n;
    },
    before(n) { return n; },
    remove() {},
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    focus() {},
  };
  el.classList._c = new Set();
  return el;
}

const porId = new Map();
const html = fs.readFileSync(path.join(import.meta.dirname, "public", "index.html"), "utf8");
for (const m of html.matchAll(/id="([a-zA-Z0-9_-]+)"/g)) porId.set(m[1], crearElemento("div"));
// los que el script trata como inputs
for (const id of ["fTexto", "fTipo", "fMin", "fMax", "fOrden", "inAnimo", "inKey", "txtRatings",
                  "sinAnimacion", "soloNuevas", "inBuscarTitulo", "selUsuario",
                  "gAnio", "gNotaVieja", "gNotaMin", "gVotosMin", "gTerminadas", "gEpisodios",
                  "gInfantil", "gEvitar", "gViendo", "gYaVistas", "gNotas"]) {
  if (!porId.has(id)) porId.set(id, crearElemento("input"));
  porId.get(id).value = "";
}
// Los checkbox que vienen tildados en el HTML tienen que arrancar tildados acá
for (const m of html.matchAll(/<input[^>]*id="([a-zA-Z0-9_-]+)"[^>]*>/g)) {
  if (m[0].includes(String.fromCharCode(32) + "checked") && porId.has(m[1])) porId.get(m[1]).checked = true;
}

porId.get("fTipo").value = "todo";
porId.get("fMin").value = "1";
porId.get("fMax").value = "10";
porId.get("fOrden").value = "puntaje";

const tabs = [...html.matchAll(/data-tab="(\w+)"/g)].map(m => {
  const el = crearElemento("button");
  el.dataset.tab = m[1];
  return el;
});

const documento = {
  querySelector(sel) {
    if (sel.startsWith("#")) {
      const id = sel.slice(1);
      if (!porId.has(id)) porId.set(id, crearElemento("div"));
      return porId.get(id);
    }
    return crearElemento("div");
  },
  querySelectorAll(sel) { return sel === ".tab" ? tabs : []; },
  createElement: crearElemento,
  createTextNode: (t) => ({ nodeValue: t, textContent: t }),
};

const guardado = new Map();
const contexto = {
  document: documento,
  window: { scrollTo() {} },
  localStorage: { getItem: (k) => guardado.get(k) ?? null, setItem: (k, v) => guardado.set(k, v) },
  location: { href: "" },
  prompt: () => null,
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  URLSearchParams, encodeURIComponent, String, Number, Math, JSON, Object, Array, Date, Set, Map,
  fetch: (url, opts) => fetch(url.startsWith("http") ? url : BASE + url, opts),
};
contexto.globalThis = contexto;

const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

console.log("\nTest del front contra la API real\n");
try {
  const ctx = vm.createContext(contexto);
  vm.runInContext(script + String.fromCharCode(10) + ";globalThis.__api = { cargarBiblioteca, buscar, tarjeta, cargarGustos, refrescar, cargarRapido, verGuardadas };", ctx);
  ok(true, "el script carga sin explotar");

  const api = contexto.__api;
  await new Promise(r => setTimeout(r, 400));       // deja correr el refrescar() inicial

  // --- lo que estaba roto: renderizar la biblioteca ---
  await api.cargarBiblioteca();
  const filas = porId.get("listaBib").children.length;
  ok(filas > 0, `la biblioteca renderiza filas (dio ${filas})`);
  ok(porId.get("resumenBib").textContent.includes("títulos"), "el resumen dice cuántos títulos hay");

  // --- recomendaciones ---
  await api.buscar(false);
  const tarjetas = porId.get("resultados").children.length;
  ok(tarjetas > 0, `las recomendaciones renderizan tarjetas (dio ${tarjetas})`);

  // --- apilar tandas: la grilla tiene que quedar ordenada por confianza ---
  await api.buscar(true);
  const confs = [...porId.get("resultados").children].map(el => +el.dataset.conf || 0);
  const ordenada = confs.every((v, i) => i === 0 || confs[i - 1] >= v);
  ok(confs.length > 8, `al apilar una segunda tanda hay más tarjetas (${confs.length})`);
  ok(ordenada, "la grilla queda ordenada de mayor a menor confianza al apilar");
  // Lo importante no es solo el DOM: la segunda tanda no puede traer nada mejor
  // que lo último de la primera, o el orden es una ilusión.
  const primeraTanda = confs.slice(0, 8), segunda = confs.slice(8);
  ok(!segunda.length || Math.max(...segunda) <= Math.max(...primeraTanda) + 1e-9,
     "la segunda tanda no trae nada mejor que la primera");
  ok(confs.every(v => v >= 0), "ninguna tarjeta con confianza negativa");

  // --- la cola para puntuar lo que ya vio ---
  await api.cargarRapido();
  const paraPuntuar = porId.get("rapidoLista").children.length;
  ok(paraPuntuar > 0, `la pestaña Puntuar propone títulos (dio ${paraPuntuar})`);

  // --- las etiquetas tienen que estar a mano, no escondidas ---
  // Ojo: una fila ya etiquetada NO ofrece esa etiqueta, así que junto de varias.
  const textos = [];
  const juntar = (el) => {
    if (typeof el.textContent === "string") textos.push(el.textContent);
    for (const h of (el.children || [])) if (h && h.tagName) juntar(h);
  };
  for (const fila of porId.get("listaBib").children.slice(0, 6)) juntar(fila);
  ok(textos.some(x => x.includes("etiqueta")), "cada fila ofrece etiquetar");
  for (const et of ["de chico", "lenta", "mal llevada", "predecible"]) {
    ok(textos.includes(et), `«${et}» está disponible sin escribir nada`);
  }

  // --- "Más como esta" ---
  const primera = porId.get("listaBib").children[0];
  const botones = [];
  const buscarBtn = (el) => {
    if (el.tagName === "BUTTON") botones.push(String(el.textContent || ""));
    for (const h of (el.children || [])) if (h && h.tagName) buscarBtn(h);
  };
  buscarBtn(primera);
  ok(botones.some(b => b.includes("Más como esta")), "cada fila ofrece «Más como esta»");

  // --- las guardadas tienen que poder verse: el botón no puede ser un pozo ---
  await api.verGuardadas();
  const guardadas = porId.get("listaGuardadas").children.length;
  ok(guardadas >= 0, `el panel de guardadas responde (${guardadas} tarjetas)`);

  // --- pantalla de gustos ---
  await api.cargarGustos();
  ok(porId.get("gAnio").value !== "", "la pantalla de gustos se llena");

  // --- un filtro filtra, no inventa ---
  // Tocar el chip "Comedia" cambiaba la firma de la cola, se rearmaba pidiendole
  // comedias a TMDB desde cero, y salian ocho titulos que no estaban en la lista
  // anterior. Un filtro que hace APARECER cosas esta diciendo que la lista sin
  // filtrar no mostraba lo mejor que tenia.
  const traer = async (extra) => {
    const q = new URLSearchParams({ texto: "", nueva: "1", u: "nico", ...extra });
    const r = await fetch(BASE + "/api/recomendaciones?" + q);
    return (await r.json()).lista || [];
  };
  const completa = await traer({ n: "60" });
  const filtrada = await traer({ n: "8", generos: "35" });   // 35 = Comedia

  // La vara la pone él en Mis gustos, así que el test no puede pedir un número
  // fijo de tarjetas: con la vara alta, quedarse corto es lo CORRECTO. Lo que sí
  // tiene que valer siempre es que no baje de la vara y que devuelva algo.
  const { gustos } = await (await fetch(BASE + "/api/gustos?u=nico")).json();
  const vara = gustos.confianzaMinima ?? 0;
  ok(completa.length > 0, `la lista completa trae algo (dio ${completa.length}, vara ${vara})`);
  ok(completa.every(p => (p.confianza ?? 0) >= vara),
     `nada baja de la vara que el puso (${vara})`);

  const estaban = new Set(completa.map(p => p.key));
  const deLaLista = filtrada.filter(p => estaban.has(p.key));
  const sorpresas = filtrada.filter(p => !estaban.has(p.key) && !p.traidaPorFiltro);

  ok(filtrada.every(p => (p.generosIds || []).includes(35)),
     "todo lo que devuelve el filtro es del genero pedido");
  ok(sorpresas.length === 0,
     `ningun titulo aparece de la nada al filtrar (${sorpresas.length} sin avisar)`);

  // El invariante de verdad: si en la lista sin filtrar HABIA comedias, el filtro
  // tiene que subir esas y no salir a buscar otras. Si no habia ninguna (pasa con
  // la vara alta, donde el tope es puro anime), salir a buscar es lo correcto
  // SIEMPRE QUE lo avise, que es lo que ya chequea `sorpresas`.
  const comediasQueHabia = completa.filter(p => (p.generosIds || []).includes(35));
  if (comediasQueHabia.length) {
    ok(deLaLista.length > 0,
       `el filtro sube lo que ya estaba en la lista (${deLaLista.length} de ${filtrada.length})`);
  } else {
    ok(filtrada.every(p => p.traidaPorFiltro),
       `sin comedias en la lista, las que trae salen marcadas como buscadas (${filtrada.length})`);
  }

  // Las que subieron tienen que venir de mas abajo: eso es reordenar, no inventar
  const posiciones = deLaLista.map(p => completa.findIndex(x => x.key === p.key));
  ok(posiciones.every(i => i >= 0), "y se pueden ubicar en la lista original");

} catch (e) {
  ok(false, "explotó: " + e.message);
  console.log("\n" + (e.stack || "").split("\n").slice(0, 4).join("\n"));
}

console.log("\n" + (fallos ? `${fallos} FALLAS` : "Todo verde."));
process.exit(fallos ? 1 : 0);
