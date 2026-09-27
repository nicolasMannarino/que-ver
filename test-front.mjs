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
  vm.runInContext(script + String.fromCharCode(10) + ";globalThis.__api = { cargarBiblioteca, buscar, tarjeta, cargarGustos, refrescar, cargarRapido, verGuardadas, validar, cargarTienta };", ctx);
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

  // --- apilar tandas: la grilla tiene que quedar ordenada ---
  // El orden que se controla es el de la POSIBLE NOTA, que es el número que se
  // ve en la tarjeta. Por confianza cruda ya no baja siempre a propósito: dentro
  // de un tramo —donde todas muestran la misma nota porque el motor no las
  // distingue— se baraja por género para no dar doce anime seguidos. Entre
  // tramos, nunca sube.
  await api.buscar(true);
  const cards = [...porId.get("resultados").children];
  const enGrilla = cards.map(el => +el.dataset.nota || 0);
  const confs = cards.map(el => +el.dataset.conf || 0);
  ok(confs.length > 8, `al apilar una segunda tanda hay más tarjetas (${confs.length})`);
  ok(enGrilla.every((v, i) => i === 0 || enGrilla[i - 1] >= v - 1e-9),
     "la posible nota nunca vuelve a subir al apilar");
  // Lo importante no es solo el DOM: la segunda tanda no puede traer un tramo
  // mejor que el de la primera, o el orden es una ilusión.
  const primeraTanda = enGrilla.slice(0, 8), segunda = enGrilla.slice(8);
  ok(!segunda.length || Math.max(...segunda) <= Math.max(...primeraTanda) + 1e-9,
     "la segunda tanda no cae en un tramo mejor que la primera");
  ok(confs.every(v => v >= 0), "ninguna tarjeta con confianza negativa");

  // --- la cola para puntuar lo que ya vio ---
  await api.cargarRapido();
  const paraPuntuar = porId.get("rapidoLista").children.length;
  ok(paraPuntuar > 0, `la pestaña Puntuar propone títulos (dio ${paraPuntuar})`);
  // Los tres botones rápidos son la mitad del punto de esa pantalla: sin ellos hay
  // que elegir un número entre diez por título y cargar gustos vuelve a ser lento.
  const btsRapido = [];
  const juntarBotones = (el) => {
    if (el.tagName === "BUTTON") btsRapido.push(String(el.textContent || ""));
    for (const h of (el.children || [])) if (h && h.tagName) juntarBotones(h);
  };
  for (const c of porId.get("rapidoLista").children.slice(0, 3)) juntarBotones(c);
  for (const t of ["me encantó", "me gustó", "no me gustó", "no la vi"]) {
    ok(btsRapido.includes(t), `la tarjeta de Puntuar ofrece «${t}»`);
  }

  // --- ¿te tienta? ---
  // La grilla de candidatas: se contesta sin haberlas visto, y es de donde salen los
  // negativos. Si no renderiza, no hay forma de cargar un "no" que no sea de a una.
  await api.cargarTienta();
  const tienta = porId.get("tientaLista").children.length;
  ok(tienta > 0, `«¿Te tienta?» propone candidatas (dio ${tienta})`);
  const btsTienta = [];
  const juntarTienta = (el) => {
    if (el.tagName === "BUTTON") btsTienta.push(String(el.textContent || ""));
    for (const h of (el.children || [])) if (h && h.tagName) juntarTienta(h);
  };
  for (const c of porId.get("tientaLista").children.slice(0, 3)) juntarTienta(c);
  for (const t of ["me tienta", "no me tienta", "ya la vi"]) {
    ok(btsTienta.includes(t), `la tarjeta de candidata ofrece «${t}»`);
  }
  // --- ¿le achunta? ---
  // Ordena lo que ya puntuó con el motor, sin la nota de cada una. Es la pantalla
  // que contesta si el orden sirve, y si se rompe no se nota por ningún otro lado.
  await api.validar();
  const validadas = porId.get("validarLista").children.length;
  ok(validadas > 0, `«¿Le achunta?» lista títulos (dio ${validadas})`);
  ok(porId.get("validarEstado").textContent.includes("puntuaste 8 o más"),
     "y los compara contra tu línea de base");

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
  // Lo de abajo de la vara puede aparecer, pero SOLO marcado como relleno: eso es
  // completarCupo(), que prefiere decir "esto es lo que hay" antes que devolver
  // media pantalla. Sin marca, sigue siendo un error.
  const RELLENO = "abajo de tu vara de confianza";
  ok(completa.every(p => (p.confianza ?? 0) >= vara || (p.avisos || []).includes(RELLENO)),
     `nada baja de la vara sin avisar (${vara})`);

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

  // --- el numero de la tarjeta tiene que decir algo ---
  // La curva agrupaba despues de la isotonica y el bloque de arriba se tragaba un
  // quinto de sus puntuaciones: las doce tarjetas de la primera tanda mostraban
  // todas 7.9 y 66%, con la confianza yendo de 1.35 a 0.69. Un numero igual en
  // todas no distingue la primera de la ultima.
  // Sobre una lista larga, no sobre una tanda: que las 12 mejores caigan todas en
  // el tramo de arriba es posible y es la verdad —ahi el motor no distingue una de
  // otra—. Lo que NO puede pasar es que la curva entera sea un solo numero.
  const tanda = await traer({ n: "30", nueva: "1" });
  const notas = new Set(tanda.map(p => p.notaEsperada));
  console.log("  notas esperadas:", [...notas].map(x => x?.toFixed(1)).join(" "));
  ok(tanda.every(p => typeof p.notaEsperada === "number"), "cada tarjeta trae su nota esperada");
  ok(notas.size > 1, `la curva distingue tramos dentro de una lista larga (${notas.size} valores)`);
  const porNota = tanda.map(p => p.notaEsperada);
  ok(porNota.every((v, i) => i === 0 || porNota[i - 1] >= v - 1e-9),
     "y la nota esperada baja junto con el orden, nunca sube");
  // La variedad va DENTRO del tramo: que el de arriba no sea todo del mismo
  // género si hay con qué. Se mide sobre el tramo mas alto de la lista larga.
  const alto = tanda.filter(p => p.notaEsperada === tanda[0].notaEsperada);
  const primerGenero = (p) => (p.generos || [])[0] || "";
  const variados = alto.filter(p => primerGenero(p) !== primerGenero(alto[0]));
  if (alto.length >= 6 && variados.length) {
    const primerOtro = alto.findIndex(p => primerGenero(p) !== primerGenero(alto[0]));
    console.log(`  tramo de arriba: ${alto.length} titulos, el primero de otro genero en el puesto ${primerOtro + 1}`);
    ok(primerOtro < 6, "dentro del tramo de arriba no van seis del mismo genero seguidas");
  }

  // --- pedir mas, con un genero vetado, tiene que seguir BAJANDO ---
  // El caso que se veia en pantalla: con Terror vetado, la segunda tanda salia
  // 51, 51, 31, 31 y despues 70. Pasaba porque lo que traia la busqueda por
  // filtro se pegaba al final de la cola con concat, sin reordenar lo que
  // todavia no se habia mostrado. Tres tandas seguidas, todas en una lista.
  const apilar = async (extra, vueltas) => {
    const todas = [];
    for (let i = 0; i < vueltas; i++) {
      todas.push(...await traer({ n: "8", nueva: i === 0 ? "1" : "0", ...extra }));
    }
    return todas;
  };
  const siempreBaja = (l) => l.every((p, i) => i === 0 || (l[i - 1].notaEsperada ?? 0) >= (p.notaEsperada ?? 0) - 1e-9);

  // Con un genero pedido la cola se queda corta y sale a buscar de ese genero:
  // esas traidas nuevas se pegaban al final tal cual, y quedaban ABAJO de cosas
  // peores que todavia no se habian mostrado.
  const porGenero = await apilar({ generos: "35" }, 4);
  ok(porGenero.length > 8, `pidiendo mas de un genero salen varias tandas (${porGenero.length})`);
  ok(siempreBaja(porGenero), "y filtrando por genero la posible nota nunca vuelve a subir");
  ok(new Set(porGenero.map(p => p.key)).size === porGenero.length, "ninguna se repite entre tandas");

  // Y sin filtro, cavando hasta agotar la cola y que entre el relleno de fondo.
  const seguidas = await apilar({}, 5);
  ok(seguidas.length > 16, `sin filtro tambien se puede seguir pidiendo (${seguidas.length})`);
  ok(siempreBaja(seguidas), "sin filtro la posible nota nunca vuelve a subir");

} catch (e) {
  ok(false, "explotó: " + e.message);
  console.log("\n" + (e.stack || "").split("\n").slice(0, 4).join("\n"));
}

console.log("\n" + (fallos ? `${fallos} FALLAS` : "Todo verde."));
process.exit(fallos ? 1 : 0);
