// Qué Ver — servidor local. Sin dependencias.
//   node server.mjs   ->   http://localhost:5173  (y la IP de tu red, para el celu)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as T from "./tmdb.mjs";
import * as M from "./motor.mjs";
import * as D from "./datos.mjs";
import * as A from "./almacen.mjs";
import * as Auth from "./auth.mjs";
import { parseAuto, mergeRatings } from "./ratings.mjs";

// Un .env al lado del server, si existe. Node 22 lo lee solo, sin dependencias.
try { process.loadEnvFile(); } catch { /* no hay .env: se usa el entorno real */ }

const DIR = import.meta.dirname;
const DATA = D.DATA;
const F_CONFIG = "config.json";                 // clave del almacén, no una ruta
const PUERTO = process.env.PORT || 5173;
const SEMILLA = ["ratings.csv", "puntuaciones.txt", "ratings.txt", "puntuaciones.csv"];

fs.mkdirSync(path.join(DATA, "cache"), { recursive: true });

// El almacén primero: hasta que no abrió, leer cualquier cosa devuelve vacío.
await A.abrir();

const CON_LOGIN = Auth.requiereLogin();

// Con base de datos, el cache de TMDB sobrevive los reinicios. Sin ella no hace
// falta: el disco de tu compu no se borra solo.
if (A.backend() === "postgres") {
  T.usarCachePersistente({
    leer: A.cacheLeer, leerVarias: A.cacheLeerVarias, escribir: A.cacheEscribir,
  });
}

// La key sale del entorno primero y del archivo después. El entorno manda
// porque es la única vía en un hosting: allá no hay disco donde dejar un
// config.json, y una key en un archivo del repo es una key publicada.
// data/config.json queda para la comodidad de correrlo en tu compu, y por eso
// data/ entero está en .gitignore. Con login, esta key global no se usa: cada
// cuenta trae la suya.
let config = D.leer(F_CONFIG, { tmdbKey: "" });
if (process.env.TMDB_API_KEY) config.tmdbKey = process.env.TMDB_API_KEY.trim();
if (config.tmdbKey) T.setKey(config.tmdbKey);

if (!CON_LOGIN) {
  D.migrar("Yo");                              // instalación vieja -> layout por usuario
  if (!D.listarUsuarios().length) D.crearUsuario("Yo");
}
for (const u of D.todosLosUsuarios()) D.migrarLentas(u.id);  // marca 🐢 vieja -> motivo "lenta"

const perfiles = new Map();                    // userId -> { perfil, vistas }
const colas = new Map();                       // userId -> { firma, lista, servidas }
// Qué dejó afuera la vara en la última búsqueda de cada uno. Sirve para que,
// cuando la lista sale vacía, la pantalla pueda decir CUÁNTO hay que bajarla en
// vez de un "no encontré nada" que no ayuda a decidir. Va en un Map de módulo
// como perfiles y colas: el server es de una sola instancia a propósito.
const diagnosticos = new Map();                // userId -> { vara, rechazadas, mejorRechazada }
// El progreso de la importación, POR PERFIL. Era una sola variable global, y
// con dos personas importando al mismo tiempo cada una veía la barra de la otra
// — incluyendo los títulos que no se pudieron resolver, que son de su lista.
const trabajos = new Map();
const SIN_TRABAJO = { activo: false, paso: "", hechas: 0, total: 0, error: null };
const trabajoDe = (id) => trabajos.get(id) || SIN_TRABAJO;
const marcarTrabajo = (id, t) => { trabajos.set(id, t); return t; };

// --- Usuario de cada request ---
// Si pide un usuario que no existe, es ERROR, no "te doy el primero": si no,
// una request con el id mal escrito termina escribiendo en la lista de otro.
class UsuarioInvalido extends Error {}
// La lista contra la que se valida es la de TU cuenta. Ese filtro es lo único
// que separa tus puntuaciones de las del de al lado: sin él, cambiar ?u= en la
// barra de direcciones alcanzaba para leer y escribir el perfil de cualquiera.
function usuarioDe(url, cuenta) {
  const lista = D.listarUsuarios(cuenta?.id || null);
  const pedido = url.searchParams.get("u");
  if (!lista.length) throw new UsuarioInvalido("Todavía no tenés ningún perfil.");
  if (!pedido) return lista[0].id;                 // primera carga, sin elegir
  const encontrado = lista.find(u => u.id === pedido);
  if (!encontrado) throw new UsuarioInvalido("No existe el perfil «" + pedido + "».");
  return encontrado.id;
}
// Mezclado sobre los defaults: si no, cada regla nueva quedaba muerta para los
// perfiles que ya existían, porque su archivo guardado no la tiene.
const prefsDe = (id) => ({ ...D.PREFS_POR_DEFECTO, ...D.leer(D.rutasDe(id).preferencias, {}) });
const estadoDe = (id) => D.leer(D.rutasDe(id).estado, { descartadas: [], vistas: [], guardadas: [], mostradas: [] });
const guardarEstado = (id, e) => D.escribir(D.rutasDe(id).estado, e);

// --- Perfil: se deriva de las puntuaciones, siempre. Fuente única de verdad. ---
async function perfilDe(id) {
  if (perfiles.has(id)) return perfiles.get(id);
  const puntuadas = D.cargar(id);
  if (!puntuadas.length) return null;

  const r = reloj("perfil " + id);
  // Una sola consulta para las 284 fichas, en vez de 284 sueltas.
  const dePg = await T.precargar(puntuadas);
  r.marca("precarga(" + dePg + ")");
  const vistas = (await M.fichas(puntuadas)).map(v => ({
    ...v, motivos: puntuadas.find(p => p.key === v.key)?.motivos || [],
  }));
  const kwNombres = {};
  for (const v of vistas) {
    for (const k of (v.d?.keywords?.keywords || v.d?.keywords?.results || [])) {
      if (k?.id && k?.name) kwNombres[k.id] = k.name;
    }
  }
  r.marca("fichas");
  const perfil = M.perfil(vistas);
  perfil.kwNombres = kwNombres;
  r.marca("perfil");
  // La curva que traduce el puntaje crudo a "cuánto de esto te gustó". Tarda
  // ~300 ms y queda en memoria con el perfil.
  perfil.curva = M.calibrar(vistas);
  r.marca("calibrar");
  const entrada = { perfil, vistas };
  perfiles.set(id, entrada);
  r.fin();
  return entrada;
}
const invalidar = (id) => { perfiles.delete(id); colas.delete(id); };

function excluidas(id, vistas) {
  const e = estadoDe(id);
  const s = new Set([...e.descartadas, ...e.vistas]);
  for (const v of vistas) s.add(v.key);
  return s;
}

// --- Importar un texto de puntuaciones al store ---
async function importar(id, listas) {
  const crudas = mergeRatings(listas);
  if (!crudas.length) throw new Error("No encontré ninguna puntuación en lo que me pasaste.");
  const mapeo = D.leer(D.rutasDe(id).mapeo, {});

  const t1 = marcarTrabajo(id, { activo: true, paso: "Buscando cada título en TMDB", hechas: 0, total: crudas.length, error: null });
  const resueltas = await M.resolver(crudas, (h, t) => { t1.hechas = h; t1.total = t; }, mapeo);

  const t2 = marcarTrabajo(id, { activo: true, paso: "Leyendo géneros, keywords y equipo", hechas: 0, total: resueltas.length, error: null });
  const conFicha = await M.fichas(resueltas, (h, t) => { t2.hechas = h; t2.total = t; });
  const { limpios, colisiones } = M.quitarColisiones(conFicha);

  for (const v of limpios) {
    D.puntuar(id, {
      key: v.key, kind: v.kind, tmdbId: v.tmdbId,
      titulo: v.d?.title || v.d?.name || v.title,
      anio: v.anio, rating: v.rating,
    });
  }
  invalidar(id);

  marcarTrabajo(id, { activo: true, paso: "Marcando lo que ya viste", hechas: 0, total: 1, error: null });
  await marcarVistas(id);

  const resueltos = new Set(limpios.map(v => v.title));
  const perdidos = crudas.filter(c => !resueltos.has(c.title)).map(c => c.title);
  marcarTrabajo(id, {
    activo: false, paso: "listo", hechas: limpios.length, total: crudas.length,
    error: null, noResueltas: crudas.length - limpios.length,
    perdidos: perdidos.slice(0, 40), colisiones,
  });
  return limpios.length;
}

// Lo que ya vio pero nunca puntuó: se marca para no ofrecérselo
async function marcarVistas(id) {
  const p = prefsDe(id);
  const lista = [...(p?.viendoAhora || []), ...(p?.yaVistas || [])];
  if (!lista.length) return 0;
  const items = await M.resolver(
    lista.map(t => ({ title: t, rating: 0, imdb: "", kind: null, year: null })),
    null, D.leer(D.rutasDe(id).mapeo, {}),
  );
  const e = estadoDe(id);
  let nuevas = 0;
  for (const it of items) if (!e.vistas.includes(it.key)) { e.vistas.push(it.key); nuevas++; }
  guardarEstado(id, e);
  return nuevas;
}

// --- Ánimo ---
const SIN_ACENTOS = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
// Los ids de género de TMDB no son los mismos en cine y en TV: en series no
// existe "Thriller" (53) ni "Acción" (28), se usan 10759 y 10765.
const PRESETS = {
  liviana: { generos: [35, 10751, 10402], durMax: 110, etiqueta: "Liviana y corta" },
  tension: { generos: [53, 9648, 27, 80, 10768], etiqueta: "Tensión" },
  autor:   { generos: [18, 36], obscura: true, etiqueta: "Cine de autor" },
  accion:  { generos: [28, 12, 878, 10759, 10765], etiqueta: "Acción" },
  rara:    { obscura: true, etiqueta: "Algo raro" },
  serie:   { soloTv: true, etiqueta: "Serie" },
  peli:    { soloPeli: true, etiqueta: "Película" },
};

function aplicarAnimo(cands, presetId, texto, generosPedidos = null, excluirGeneros = null, maxMin = null) {
  const p = PRESETS[presetId] || null;
  const palabras = SIN_ACENTOS(texto).split(/\s+/).filter(w => w.length > 3);
  const salida = [];
  for (const c of cands) {
    c.boostAnimo = 0;
    if (p?.soloTv && c.kind !== "tv") continue;
    if (p?.soloPeli && c.kind !== "movie") continue;

    const generosDe = (c.detalle?.d?.genres || []).map(g => g.id);
    // Filtros que él eligió a mano: mandan sobre el ánimo
    if (excluirGeneros?.length && generosDe.some(g => excluirGeneros.includes(g))) continue;
    // Tope de duración. En series es el largo del capítulo, que es lo que importa
    // para "tengo hora y media". Si TMDB no sabe cuánto dura, la dejo pasar: sacar
    // por falta de dato es peor que mostrarla con el número en blanco.
    if (maxMin && c.detalle?.dur && c.detalle.dur > maxMin) continue;
    if (generosPedidos?.length && !generosDe.some(g => generosPedidos.includes(g))) continue;
    if (p || palabras.length) {
      const gen = (c.detalle?.d?.genres || []).map(g => g.id);
      if (p?.generos) {
        const cruce = gen.filter(g => p.generos.includes(g)).length;
        if (!cruce) continue;                    // filtro duro: si no es del palo, no va
        c.boostAnimo += 0.7 * Math.min(cruce, 2);
      }
      if (p?.durMax && c.detalle?.dur && c.detalle.dur > p.durMax) c.boostAnimo -= 0.7;
      if (p?.obscura) c.boostAnimo += Math.max(0, 1 - Math.log10(1 + c.votos) / 4) * 0.9;
      if (palabras.length) {
        const kws = (c.detalle?.d?.keywords?.keywords || c.detalle?.d?.keywords?.results || [])
          .map(k => SIN_ACENTOS(k.name));
        const txt = SIN_ACENTOS((c.resumen || "") + " " + (c.titulo || ""));
        let hits = 0;
        for (const w of palabras) {
          if (kws.some(k => k.includes(w))) hits += 2;
          else if (txt.includes(w)) hits += 1;
        }
        c.boostAnimo += Math.min(hits, 6) * 0.45;
      }
    }
    salida.push(c);
  }
  return salida;
}

// --- Cronómetro ------------------------------------------------------------
// Una búsqueda que tarda veinte segundos en el hosting y uno en tu compu no se
// diagnostica adivinando. Esto imprime en qué se va el tiempo, tramo por tramo.
//
// Apagado salvo que pongas MEDIR=1: ya cumplió su trabajo —encontró que la CPU
// de Render es hasta 8 veces más lenta y que se guardaban 61 KB por ficha para
// leerle 2— y no hace falta una línea de log por búsqueda para siempre. Queda
// puesto porque la próxima vez que algo ande lento, esto lo contesta en minutos.
const MEDIR = process.env.MEDIR === "1";

function reloj(nombre) {
  if (!MEDIR) return { marca() {}, fin() { return 0; } };
  const t0 = Date.now();
  let ultimo = t0;
  const tramos = [];
  return {
    marca(que) {
      const ahora = Date.now();
      const ms = ahora - ultimo;
      if (ms >= 1) tramos.push(que + " " + ms + "ms");
      ultimo = ahora;
    },
    fin(extra = "") {
      const total = Date.now() - t0;
      console.log(`  [${nombre}] ${total}ms  ${tramos.join(" · ")}${extra ? "  " + extra : ""}`);
      return total;
    },
  };
}

async function enriquecer(finalistas) {
  // Lo mismo que con el perfil: una consulta para los ~120 candidatos en vez de
  // 120 sueltas. Es el grueso de lo que tarda una búsqueda con el cache frío.
  const r = reloj("enriquecer " + finalistas.length);
  const dePg = await T.precargar(finalistas);
  r.marca("precarga(" + dePg + ")");
  const pedidosAntes = T.stats().requests;
  const salida = (await T.pool(finalistas, 8, async (c) => {
    const d = await T.details(c.kind, c.tmdbId);
    if (!d) return c;
    const r = M.rasgos(d, c.kind);
    c.detalle = { d, ...r };
    c.duracion = r.dur; c.anio = r.anio; c.generos = r.generos;
    c.generosIds = r.generosIds;
    c.episodios = r.episodios; c.temporadas = r.temporadas; c.status = r.status;
    c.imdb = d.imdb_id || null;
    return c;
  })).filter(Boolean);
  r.marca("fichas");
  r.fin(`(${T.stats().requests - pedidosAntes} a TMDB)`);
  return salida;
}

const paraElFront = (c, perfil) => ({
  key: c.key, kind: c.kind, tmdbId: c.tmdbId, titulo: c.titulo,
  anio: c.anio, duracion: c.duracion, generos: c.generos || [],
  generosIds: c.generosIds || [],
  episodios: c.episodios || null, temporadas: c.temporadas || null, status: c.status || null,
  poster: c.poster ? "https://image.tmdb.org/t/p/w342" + c.poster : null,
  resumen: c.resumen, nota: c.nota, votos: c.votos,
  imdb: c.imdb || null, avisos: c.avisos || [],
  motivo: M.motivo(c, perfil), score: +c.score.toFixed(3),
  masParecidaTuya: c.masParecidaTuya || null,
  confianza: +(c.confianza ?? 0).toFixed(3),
  probable: M.probabilidad(perfil.curva, c.confianza ?? 0),
});

async function recomendar(id, { preset, texto, n = 8, generos = null, sinAnimacion = false, soloNuevas = false, porConfianza = true, semilla = null, excluir = null, maxMin = null }) {
  const p = await perfilDe(id);
  if (!p) throw new Error("Todavía no cargaste tus puntuaciones.");
  const { perfil, vistas } = p;
  const estado = estadoDe(id);

  // Lo ya ofrecido no vuelve nunca: si no, "Otras" repetía la misma tarjeta.
  const excl = excluidas(id, vistas);
  for (const k of estado.mostradas) excl.add(k);

  // Lo que él eligió a mano manda; si no eligió nada, van los géneros del ánimo
  const generosPedidos = generos?.length ? generos : null;
  const generosParaSemillas = generosPedidos || PRESETS[preset]?.generos || null;
  const excluirGeneros = [...(sinAnimacion ? [16] : []), ...(excluir || [])];
  // El tipo tiene que viajar hasta las fuentes: si se filtraba recién al final,
  // los 120 candidatos que enriquecía eran casi todos películas y quedaban 3 series.
  const tipo = PRESETS[preset]?.soloTv ? "tv" : PRESETS[preset]?.soloPeli ? "movie" : null;
  const P = prefsDe(id);

  const traer = async (ex, paginas) => {
    const [vecinos, catalogo] = await Promise.all([
      M.candidatos(perfil, { semillas: paginas > 1 ? 45 : 28, excluir: ex, generos: generosParaSemillas, tipo, excluirGeneros }),
      M.candidatosPorPerfil(perfil, {
        excluir: ex, generos: generosParaSemillas, anioMinimo: P?.anioMinimo, paginas, tipo, excluirGeneros, maxMin, votosMinimos: P?.votosMinimos,
      }),
    ]);
    const mapa = new Map(catalogo.map(c => [c.key, c]));
    for (const c of vecinos) mapa.set(c.key, c);   // si está en las dos, gana la de semillas
    return [...mapa.values()];
  };

  let prefsEfectivas = soloNuevas ? { ...P, notaMinimaViejas: 99 } : P;
  // Pidiendo "más como esta", la vara de popularidad estorba: el vecindario de
  // Nueve reinas es cine latino, que en TMDB tiene pocos votos y quedaba afuera.
  if (semilla) {
    prefsEfectivas = {
      ...prefsEfectivas,
      votosMinimos: Math.min(prefsEfectivas.votosMinimos ?? 150, 60),
      notaMinima: Math.min(prefsEfectivas.notaMinima ?? 6.4, 6),
      notaMinimaViejas: soloNuevas ? 99 : Math.min(prefsEfectivas.notaMinimaViejas ?? 8, 7.4),
    };
  }
  // Su vara de exigencia. Es la que decide si prefiere 12 buenas o 30 con relleno.
  const piso = prefsEfectivas?.confianzaMinima ?? 0;
  // Hasta dónde ya cavamos en el catálogo. ANTES esto salía de mostradas.length/24,
  // y ahí estaba el problema de "mostrame otras tarda muchísimo": si una ronda no
  // devolvía nada —cosa habitual desde que hay vara— mostradas no crecía, el número
  // no avanzaba, y el clic siguiente volvía a pedirle a TMDB EXACTAMENTE las mismas
  // páginas. Con el cache frío son ~100 discover más 135 fichas, cada vez, para
  // devolver cero otra vez. Ahora el contador se guarda y siempre avanza, así que
  // cada clic mira páginas nuevas: más rápido y además trae cosas distintas.
  // TMDB corta en la página 500; al llegar cerca del fondo vuelve a empezar, que
  // para entonces está todo cacheado y es instantáneo.
  const arranque = ((estado.profundidadCatalogo || 0) * 4 > 400) ? 0 : (estado.profundidadCatalogo || 0);

  // Rasgos del título semilla, para medir parecido directo contra él
  let rasgosSemilla = null;
  if (semilla) {
    const [k, sid] = String(semilla).split(":");
    const ds = await T.details(k, +sid).catch(() => null);
    if (ds) rasgosSemilla = M.rasgos(ds, k).features;
  }

  // Lo que la vara va dejando afuera, por clave para no contar dos veces la misma
  // cuando cae en dos rondas distintas. Con los puntajes guardados se puede
  // responder la pregunta que importa: "¿en cuánto tengo que poner la vara para
  // ver 8?" — y no solo "no hay nada".
  const rechazadas = new Map();

  // Puntúa un lote de candidatos y devuelve los que valen la pena mostrar
  const evaluar = async (cands) => {
    if (!cands.length) return [];
    M.puntuar(cands, perfil);                     // pasada barata, sin pedir detalles
    // Cuota fija para los del catálogo: su valor está en la afinidad de rasgos,
    // que recién se calcula con los detalles.
    const deSemilla = cands.filter(c => !c.origen).slice(0, 75);
    const dePerfil = cands.filter(c => c.origen).slice(0, 60);
    const conDetalle = await enriquecer([...deSemilla, ...dePerfil]);
    let utiles = M.filtrar(conDetalle, perfil, prefsEfectivas);
    // Y fuera las que son la 2 o la 3 de una saga que él no empezó.
    const huerfanas = await M.secuelasHuerfanas(utiles, perfil);
    if (huerfanas.size) utiles = utiles.filter(c => !huerfanas.has(c.key));
    const lista = M.puntuar(
      aplicarAnimo(utiles, preset, texto, generosPedidos, excluirGeneros, maxMin),
      perfil, { prefs: prefsEfectivas });
    // Con semilla, la confianza es el parecido con ESA película, no la afinidad
    // con el promedio de su gusto. Si no, el vecindario de Nueve reinas quedaba
    // en cero y volvía lo mismo de siempre.
    if (rasgosSemilla) {
      for (const c of lista) {
        const par = M.parecidoA(rasgosSemilla, c.detalle?.features || []);
        c.confianza = par * 6;                 // 0.17 de Jaccard ya es mucho parecido
      }
    }
    // El piso lo pone él, no yo. `confianzaMinima` estaba declarada en las
    // preferencias por defecto desde el principio y NO LA LEÍA NADIE: el filtro
    // era ">= 0" a mano, así que entraba cualquier cosa que no fuera negativa.
    // Medido sobre un pedido de 60: de 30 tarjetas que salían, 18 estaban abajo
    // de 0.3 — relleno con el que la lista se veía llena y no servía.
    for (const c of lista) {
      const cf = c.confianza ?? 0;
      if (cf < piso) rechazadas.set(c.key, cf);
    }
    return lista.filter(c => (c.confianza ?? 0) >= piso);
  };

  // Cava por niveles hasta juntar suficientes CON CONFIANZA, no suficientes
  // candidatos: con el piso en 0, un pozo grande igual podía dar 3 resultados.
  const juntadas = new Map();
  const sumar = (arr) => { for (const c of arr) if (!juntadas.has(c.key)) juntadas.set(c.key, c); };

  // "Más como esta": el vecindario de ESE título manda. Si se mezclaba con el
  // pozo general, el pedido se diluía y volvía lo mismo de siempre.
  if (semilla) {
    sumar(await evaluar(await M.candidatosDesde(semilla, { excluir: excl, paginas: 5 })));
    if (juntadas.size >= n) {
      const soloSemilla = [...juntadas.values()].sort((a, b) => (b.confianza ?? 0) - (a.confianza ?? 0));
      const elegidas = M.diversificar(soloSemilla, n, 5).map(c => paraElFront(c, perfil));
      for (const x of elegidas) if (!estado.mostradas.includes(x.key)) estado.mostradas.push(x.key);
      guardarEstado(id, estado);
      return elegidas;
    }
  }
  const rr = reloj("recomendar n=" + n);
  sumar(await evaluar(await traer(excl, 1)));
  rr.marca("ronda1");
  if (juntadas.size < n) { sumar(await evaluar(await traer(excl, 3))); rr.marca("ronda2"); }
  // Cava hasta juntar n que PASEN LA VARA. Antes cortaba al llegar a n candidatos
  // cualesquiera: se llenaba de relleno de 0.01 y dejaba de buscar justo cuando
  // todavía había buenas más adentro del catálogo. Por eso se repetían siempre las
  // mismas: no es que no hubiera más, es que dejaba de cavar.
  // Presupuesto de tiempo, no de vueltas. Cada salto son 10 consultas a TMDB más
  // hasta 60 fichas: con el cache frío, diez saltos medían 21 SEGUNDOS de espera
  // mirando un botón. Ahora corta a los 6 y, como la profundidad queda guardada,
  // el clic siguiente sigue desde donde dejó en vez de empezar de nuevo.
  const limite = Date.now() + 6000;
  let cavados = 0;
  for (let salto = 0; salto < 10 && juntadas.size < n && Date.now() < limite; salto++, cavados++) {
    sumar(await evaluar(await M.candidatosAmplios(perfil, {
      excluir: excl, generos: generosParaSemillas, anioMinimo: prefsEfectivas?.anioMinimo, tipo,
      desde: 1 + (arranque + salto) * 4, paginas: 5, excluirGeneros, maxMin, votosMinimos: prefsEfectivas?.votosMinimos,
    })));
  }
  estado.profundidadCatalogo = arranque + cavados;
  rr.marca("catalogo");
  const conFe = [...juntadas.values()];
  const ordenada = porConfianza
    ? conFe.sort((a, b) => (b.confianza ?? 0) - (a.confianza ?? 0))
    : conFe;
  // Con el orden por confianza aflojo el tope por género: si no, la diversidad
  // saltea buenas y termina raspando el fondo teniendo mejores disponibles.
  const salida = M.diversificar(ordenada, n, porConfianza ? 5 : 3).map(c => paraElFront(c, perfil));
  // Anoto qué le prometí de cada una. Cuando la puntúe, se compara contra esto:
  // es la única medición que no está sesgada por lo que él ya había elegido ver.
  estado.predicciones = estado.predicciones || {};
  for (const s of salida) {
    if (!estado.mostradas.includes(s.key)) estado.mostradas.push(s.key);
    if (!estado.predicciones[s.key] && s.probable != null) {
      estado.predicciones[s.key] = { prob: s.probable, titulo: s.titulo, fecha: new Date().toISOString() };
    }
  }
  guardarEstado(id, estado);
  rr.fin(`(${juntadas.size} candidatos)`);
  const fuera = [...rechazadas.values()].sort((a, b) => b - a);
  // La vara a la que aparecerían 8. Si no hay ni 8 abajo, la de la última que hay.
  const paraVer = (k) => (fuera.length ? +Math.max(0, fuera[Math.min(k, fuera.length) - 1]).toFixed(2) : null);
  diagnosticos.set(id, {
    vara: piso,
    rechazadas: fuera.length,
    mejorRechazada: fuera.length ? +fuera[0].toFixed(2) : null,
    varaParaOcho: paraVer(8),
    cuantasParaOcho: Math.min(8, fuera.length),
  });
  return salida;
}

// Con los mismos filtros, "mostrame otras" tiene que seguir bajando por la MISMA
// lista ordenada. Antes cada tanda era una consulta nueva sobre un pozo distinto,
// así que la segunda podía traer algo mejor que la primera: eso no es estar
// ordenado. Ahora se arma una cola larga una vez y se sirve por pedazos.
async function recomendarEnOrden(id, opciones) {
  const { n = 8, nueva = false, generos = null, excluir = null, ...base } = opciones;
  // Arrancar una búsqueda nueva limpia "lo ya mostrado". Antes se acumulaba para
  // siempre: a las 63 el pozo se secaba, y algo que le había interesado y no
  // marcó desaparecía sin manera de volver a encontrarlo.
  if (nueva) {
    const e = estadoDe(id);
    e.mostradas = [];
    // Una búsqueda nueva vuelve a empezar también la excavación: "Dame algo para
    // ver" pone todo en juego otra vez, y esas primeras páginas ya están en cache.
    e.profundidadCatalogo = 0;
    guardarEstado(id, e);
    colas.delete(id);
  }

  // Los géneros NO entran en la firma de la cola, y ahí está el arreglo.
  //
  // Antes sí entraban: tocar el chip "Comedia" cambiaba la firma, se rearmaba la
  // cola pidiéndole comedias a TMDB desde cero, y salían ocho títulos que no
  // estaban en la lista anterior. Filtrar hacía APARECER películas de la nada en
  // vez de sacar las que no correspondían, que es lo único que un filtro puede
  // hacer sin volverse mentiroso: si al filtrar por comedia aparece una comedia
  // al 94% que sin filtro nunca ofreció, entonces la lista sin filtrar no estaba
  // mostrando lo mejor que tenía.
  //
  // Ahora el género es una VISTA sobre la misma cola: saca las que no son del
  // género y reordena, sin inventar nada.
  const firma = JSON.stringify(base);
  let cola = colas.get(id);

  if (!cola || cola.firma !== firma) {
    // 24 y no 60. El pozo de candidatos da ~48 como mucho, así que pidiendo 60
    // nunca llegaba y agotaba TODAS las fuentes en cada búsqueda: las dos rondas
    // de vecinos más cuatro barridos de catálogo. Medido: 1308 ms contra 774 ms,
    // y 24 siguen siendo tres tandas completas de 8. En la CPU de Render, que es
    // entre 3 y 8 veces más lenta que una de escritorio, esa diferencia son
    // segundos que el que mira siente.
    //
    // diversificar() rellena el final sin respetar el orden, así que reordeno:
    // la cola tiene que bajar siempre, tanda tras tanda.
    const lista = (await recomendar(id, { ...base, n: 24 }))
      .sort((a, b) => (b.confianza ?? 0) - (a.confianza ?? 0));
    cola = { firma, lista, servidas: new Set(), vista: null };
    colas.set(id, cola);
  }

  // Cambiar el filtro empieza la vista de cero. Sin esto, un título que ya te
  // mostré queda marcado como servido y no puede volver a subir — y lo que uno
  // espera al filtrar por comedia es justamente que la comedia que estaba
  // séptima pase a estar primera, no que desaparezca por haberla visto.
  // "Mostrame otras" con el MISMO filtro sí sigue bajando, como antes.
  const vista = JSON.stringify({ generos: generos || [], excluir: excluir || [] });
  if (cola.vista !== vista) { cola.servidas = new Set(); cola.vista = vista; }

  const pasaElFiltro = (p) => {
    const ids = p.generosIds || [];
    if (excluir?.length && ids.some(g => excluir.includes(g))) return false;
    if (generos?.length && !ids.some(g => generos.includes(g))) return false;
    return true;
  };
  const disponibles = () => cola.lista.filter(p => pasaElFiltro(p) && !cola.servidas.has(p.key));

  let tanda = disponibles().slice(0, n);

  // Recién si lo que ya tenía no alcanza salgo a buscar de ese género. Van al
  // final de la cola y marcadas: son las únicas que pueden aparecer sin haber
  // estado antes, y la tarjeta lo dice, así que no sorprenden.
  // Salir a buscar solo si lo que hay no alcanza para llenar media pantalla.
  // Antes bastaba con que faltara UNA para disparar la búsqueda, y esa búsqueda
  // para un género del que casi no tenés nada cuesta ~5 segundos: no vale la pena
  // hacerte esperar eso por la octava tarjeta cuando ya hay seis buenas. Si querés
  // más, "mostrame otras" las va a buscar.
  const MINIMO = Math.min(4, n);
  if (tanda.length < MINIMO && (generos?.length || excluir?.length)) {
    // Pido 24 y no 60: para un género del que casi no tenés nada —terror, con una
    // sola puntuada— juntar 60 candidatos nuevos obliga al motor a barrer cuatro
    // tandas de páginas del catálogo esquivando las 60 que ya están en la cola, y
    // eso medía 17 segundos. Con 24 alcanza para llenar la pantalla, y si pedís
    // más se vuelve a llamar.
    const mas = await recomendar(id, { ...base, generos, excluir, n: 24 });
    const conocidas = new Set(cola.lista.map(x => x.key));
    cola.lista = cola.lista.concat(
      mas.filter(x => !conocidas.has(x.key))
         .map(x => ({ ...x, traidaPorFiltro: true }))
         .sort((a, b) => (b.confianza ?? 0) - (a.confianza ?? 0)));
    tanda = disponibles().slice(0, n);
  }

  // Sin filtro y con la cola agotada: sigo abajo de lo último servido, para que
  // "mostrame otras" nunca traiga algo mejor que lo que ya ofreció.
  if (tanda.length < n && !generos?.length && !excluir?.length) {
    const mas = await recomendar(id, { ...base, n: 24 });
    const conocidas = new Set(cola.lista.map(x => x.key));
    const tope = tanda.length ? tanda[tanda.length - 1].confianza : Infinity;
    cola.lista = cola.lista.concat(
      mas.filter(x => !conocidas.has(x.key) && (x.confianza ?? 0) <= tope)
         .sort((a, b) => (b.confianza ?? 0) - (a.confianza ?? 0)));
    tanda = disponibles().slice(0, n);
  }

  for (const p of tanda) cola.servidas.add(p.key);
  return tanda;
}

// --- HTTP ---
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css",
  ".js": "text/javascript", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png",
};

// Contestar recién cuando lo que se escribió está DE VERDAD en la base.
//
// escribir() encola y vuelve enseguida, así que hasta acá el 200 salía con la
// escritura todavía en vuelo. Con una sola instancia daba igual —el que
// preguntaba era el mismo proceso, y su memoria ya tenía el valor nuevo—, pero
// con dos el "ok" es justamente la señal de que el otro lado puede ir a leer.
// Si sale antes de tiempo, puntuás en el celular, recargás la compu al toque y
// no está: la app de allá contesta la verdad de una base que todavía no
// recibió nada.
//
// Cuando no hay nada encolado —o sea, en toda lectura— esto resuelve en el
// acto y no cuesta nada.
async function json(res, code, obj) {
  await A.drenar();
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}
function cuerpo(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", c => { b += c; if (b.length > 20e6) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch { resolve({}); } });
  });
}
// Sembrar desde un .txt/.csv suelto es una comodidad de correrlo en tu compu:
// en el hosting no hay disco donde dejarlo, así que ahí simplemente no existe.
const archivoSemilla = () => {
  if (A.backend() !== "disco") return null;
  const f = SEMILLA.map(x => path.join(DATA, x)).find(x => fs.existsSync(x));
  return f ? path.basename(f) : null;
};

// Lo único que se puede tocar sin sesión. La lista es corta y explícita a
// propósito: si mañana agrego una ruta y me olvido de anotarla, queda cerrada,
// que es el lado correcto para equivocarse.
// /api/pulso no pide sesión porque trae su propio token y no devuelve datos
// de nadie: solo cuánto tardó la máquina en hacer un trabajo fijo.
const LIBRES = new Set(["/api/sesion", "/api/registro", "/api/entrar", "/api/salir", "/api/pulso"]);
const ipDe = (req) =>
  (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "";

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  // Antes de mirar nada, traer lo que cambió en la base. Esto es lo que hace
  // que la app de tu compu y la publicada sean la MISMA app: si puntuás algo en
  // el celular, la de acá lo ve en el request siguiente. Sin esto, este proceso
  // contesta con la foto que cargó al arrancar y encima la pisa al guardar.
  //
  // Sólo para /api/: el HTML y el CSS no leen datos de nadie y no hay por qué
  // gastarles una consulta.
  if (url.pathname.startsWith("/api/")) await sincronizar();

  const cuenta = CON_LOGIN ? Auth.leerSesion(req.headers.cookie) : null;

  if (CON_LOGIN && !cuenta && url.pathname.startsWith("/api/") && !LIBRES.has(url.pathname)) {
    return json(res, 401, { error: "Entrá con tu cuenta." });
  }
  // Cada request pega contra TMDB con la key de SU cuenta.
  return T.conKey(CON_LOGIN ? Auth.keyTmdbDe(cuenta) : null,
                  () => manejar(req, res, url, cuenta));
});

// Lo que cambió en la base invalida lo que derivamos de ello. El perfil (pesos
// de género, calibración) sale de puntuaciones.json y preferencias.json: si el
// archivo cambió, el perfil armado a partir de él ya no vale. Se tira y se
// vuelve a armar en el próximo pedido.
//
// Va envuelto en try porque se llama ANTES del try de manejar(): una excepción
// acá dejaba el request sin respuesta ninguna, colgado hasta que el navegador
// se aburra. Quedarse con datos de hace un minuto es mucho mejor que eso.
async function sincronizar() {
  try {
    const cambiadas = await A.refrescar();
    if (!cambiadas || !cambiadas.size) return;
    for (const clave of cambiadas) {
      const m = /^usuarios\/([^/]+)\//.exec(clave);
      if (m) invalidar(m[1]);
    }
  } catch (e) {
    console.error("[server] no pude sincronizar:", e.message);
  }
}

async function manejar(req, res, url, cuenta) {
  try {
    // ---- cuentas ----
    if (url.pathname === "/api/sesion") {
      return json(res, 200, {
        conLogin: CON_LOGIN,
        cuenta: Auth.publico(cuenta) || null,
        // Para que la pantalla de registro sepa si mostrar el campo del código.
        necesitaCodigo: Auth.cantidadDeCuentas() > 0,
        largoMinimo: Auth.LARGO_MINIMO,
      });
    }
    if (url.pathname === "/api/registro" && req.method === "POST") {
      if (!CON_LOGIN) return json(res, 400, { error: "Esta instalación no usa cuentas." });
      const { email, pass, codigo } = await cuerpo(req);
      const c = Auth.registrar(email, pass, { codigo, ip: ipDe(req) });
      D.crearUsuario("Yo", c.id);                 // toda cuenta arranca con un perfil
      res.setHeader("set-cookie", Auth.cookieDeSesion(Auth.crearSesion(c.id), req));
      return json(res, 200, { cuenta: Auth.publico(c) });
    }
    if (url.pathname === "/api/entrar" && req.method === "POST") {
      if (!CON_LOGIN) return json(res, 400, { error: "Esta instalación no usa cuentas." });
      const { email, pass } = await cuerpo(req);
      const c = Auth.entrar(email, pass, ipDe(req));
      res.setHeader("set-cookie", Auth.cookieDeSesion(Auth.crearSesion(c.id), req));
      return json(res, 200, { cuenta: Auth.publico(c) });
    }
    if (url.pathname === "/api/salir" && req.method === "POST") {
      res.setHeader("set-cookie", Auth.cookieVacia(req));
      return json(res, 200, { ok: true });
    }
    // Cierra la sesión de TODOS los dispositivos, incluido este.
    if (url.pathname === "/api/salir-de-todos" && req.method === "POST") {
      Auth.cerrarTodasLasSesiones(cuenta.id);
      res.setHeader("set-cookie", Auth.cookieVacia(req));
      return json(res, 200, { ok: true });
    }

    if (url.pathname === "/api/cambiar-pass" && req.method === "POST") {
      const { actual, nueva } = await cuerpo(req);
      const c = Auth.cambiarPass(cuenta.id, actual, nueva);
      // Cambiar la clave cierra las otras sesiones, así que a ESTA hay que
      // renovarla o el que la cambió se queda afuera él mismo.
      res.setHeader("set-cookie", Auth.cookieDeSesion(Auth.crearSesion(c.id), req));
      return json(res, 200, { ok: true });
    }

    // Vuelve a leer la base. Hace falta después de escribir por afuera (el
    // script de migración): la memoria de este proceso quedó vieja.
    if (url.pathname === "/api/recargar" && req.method === "POST") {
      if (!Auth.esAdmin(cuenta)) return json(res, 400, { error: "Solo el dueño puede recargar." });
      const n = await A.recargar();
      perfiles.clear(); colas.clear();          // los perfiles derivados también
      return json(res, 200, { ok: true, claves: n, usuarios: D.listarUsuarios(cuenta?.id || null) });
    }

    // ---- invitaciones (solo el dueño) ----
    if (url.pathname === "/api/invitaciones" && req.method === "GET") {
      return json(res, 200, { admin: Auth.esAdmin(cuenta), lista: Auth.listarInvitaciones(cuenta) });
    }
    if (url.pathname === "/api/invitaciones" && req.method === "POST") {
      const { etiqueta, maxUsos, dias } = await cuerpo(req);
      const r = Auth.crearInvitacion(cuenta, { etiqueta, maxUsos, dias });
      // El código en claro viaja UNA vez y no se puede volver a pedir.
      return json(res, 200, { codigo: r.codigo, invitacion: r.invitacion, lista: Auth.listarInvitaciones(cuenta) });
    }
    if (url.pathname === "/api/invitaciones/revocar" && req.method === "POST") {
      const { id } = await cuerpo(req);
      const hash = Auth.hashDeInvitacionCorta(String(id || ""));
      if (!hash) return json(res, 400, { error: "No existe esa invitación." });
      Auth.revocarInvitacion(cuenta, hash);
      return json(res, 200, { lista: Auth.listarInvitaciones(cuenta) });
    }

    if (url.pathname === "/api/estado") {
      const id = usuarioDe(url, cuenta);
      const puntuadas = D.cargar(id);
      const e = estadoDe(id);
      return json(res, 200, {
        tieneKey: CON_LOGIN ? !!Auth.keyTmdbDe(cuenta) : !!config.tmdbKey,
        conLogin: CON_LOGIN,
        cuenta: Auth.publico(cuenta) || null,
        usuarios: D.listarUsuarios(cuenta?.id || null),
        usuario: id,
        cantidad: puntuadas.length,
        pelis: puntuadas.filter(x => x.kind === "movie").length,
        series: puntuadas.filter(x => x.kind === "tv").length,
        guardadas: e.guardadas.length,
        descartadas: e.descartadas.length,
        archivoDetectado: archivoSemilla(),
        trabajo: trabajoDe(id),
        requests: T.stats().requests,
      });
    }

    // La key se prueba contra TMDB antes de guardarla: guardar una key rota es
    // dejar la app muerta sin decir por qué.
    if (url.pathname === "/api/key" && req.method === "POST") {
      const { key } = await cuerpo(req);
      const limpia = String(key || "").trim();
      if (!limpia) return json(res, 400, { error: "Pegá tu API key de TMDB." });
      try {
        await T.conKey(limpia, () => T.tmdb("/configuration", {}, { ttl: 0 }));
      } catch (e) {
        const msg = e.message === "BAD_KEY" ? "La API key no es válida." : "No pude hablar con TMDB: " + e.message;
        return json(res, 400, { error: msg });
      }
      if (CON_LOGIN) {
        Auth.cambiarKeyTmdb(cuenta.id, limpia);   // cifrada contra tu cuenta
      } else {
        config.tmdbKey = limpia;
        T.setKey(limpia);
        D.escribir(F_CONFIG, config);
      }
      return json(res, 200, { ok: true });
    }

    // ---- usuarios ----
    if (url.pathname === "/api/usuarios" && req.method === "POST") {
      const { nombre } = await cuerpo(req);
      if (!String(nombre || "").trim()) return json(res, 400, { error: "Poné un nombre." });
      const id = D.crearUsuario(nombre, cuenta?.id || null);
      return json(res, 200, { id, usuarios: D.listarUsuarios(cuenta?.id || null) });
    }
    if (url.pathname === "/api/usuarios/borrar" && req.method === "POST") {
      const { id } = await cuerpo(req);
      const mios = D.listarUsuarios(cuenta?.id || null);
      // El id llega del cliente: sin este chequeo, un POST a mano borraba el
      // perfil de otra cuenta con solo adivinar el nombre.
      if (!mios.some(u => u.id === id)) return json(res, 400, { error: "Ese perfil no es tuyo." });
      if (mios.length <= 1) return json(res, 400, { error: "Tiene que quedar al menos un usuario." });
      D.borrarUsuario(id);
      invalidar(id);
      return json(res, 200, { usuarios: D.listarUsuarios(cuenta?.id || null) });
    }

    if (url.pathname === "/api/importar" && req.method === "POST") {
      const id = usuarioDe(url, cuenta);
      const { texto, usarArchivo } = await cuerpo(req);
      const listas = [];
      if (usarArchivo && A.backend() === "disco") {
        for (const f of SEMILLA) {
          const p = path.join(DATA, f);
          if (fs.existsSync(p)) listas.push(parseAuto(fs.readFileSync(p, "utf8")));
        }
      }
      if (texto?.trim()) listas.push(parseAuto(texto));
      if (!listas.length) return json(res, 400, { error: "No me pasaste nada para importar." });
      importar(id, listas).catch(e => {
        marcarTrabajo(id, { activo: false, paso: "error", hechas: 0, total: 0, error: e.message });
      });
      return json(res, 200, { ok: true });
    }

    if (url.pathname === "/api/recomendaciones") {
      const cron = reloj("BUSQUEDA");
      const lista = await recomendarEnOrden(usuarioDe(url, cuenta), {
        preset: url.searchParams.get("preset") || null,
        texto: url.searchParams.get("texto") || "",
        n: parseInt(url.searchParams.get("n"), 10) || 8,
        generos: (url.searchParams.get("generos") || "").split(",").map(Number).filter(Boolean),
        excluir: (url.searchParams.get("excluir") || "").split(",").map(Number).filter(Boolean),
        sinAnimacion: url.searchParams.get("sinAnimacion") === "1",
        maxMin: parseInt(url.searchParams.get("maxMin"), 10) || null,
        soloNuevas: url.searchParams.get("soloNuevas") === "1",
        porConfianza: url.searchParams.get("porConfianza") !== "0",
        semilla: url.searchParams.get("semilla") || null,
        nueva: url.searchParams.get("nueva") === "1",
      });
      cron.fin(`-> ${lista.length} tarjetas` +
               (url.searchParams.get("generos") ? ` (genero ${url.searchParams.get("generos")})` : "") +
               (url.searchParams.get("nueva") === "1" ? " [nueva]" : " [otras]"));
      // El diagnóstico viaja siempre: si la lista sale vacía, la pantalla tiene
      // que poder decir cuánto hay que bajar la vara, no solo que no hay nada.
      return json(res, 200, { lista, diagnostico: diagnosticos.get(usuarioDe(url, cuenta)) || null });
    }

    // ---- puntuar, desde la tarjeta o desde la biblioteca ----
    if (url.pathname === "/api/puntuar" && req.method === "POST") {
      const id = usuarioDe(url, cuenta);
      const item = await cuerpo(req);
      if (!item.key || !item.rating) return json(res, 400, { error: "Falta el título o el puntaje." });
      if (item.dejada) item.motivos = [...(item.motivos || []), "la dejé"];
      const guardada = D.puntuar(id, item);   // item.motivos viaja si viene
      // Ya está puntuada: no necesita seguir marcada como vista ni descartada
      const e = estadoDe(id);
      e.vistas = e.vistas.filter(k => k !== item.key);
      e.descartadas = e.descartadas.filter(k => k !== item.key);
      // Si se la había recomendado, ahora sé si le acerté — pero SOLO si la vio
      // por eso. Puntuar algo que ya había visto de antes no dice nada sobre si
      // la app acierta: le mostraba una que él ya conocía y ya le gustaba, tocaba
      // 9, y quedaba anotado como gol propio. El sesgo iba siempre a favor.
      // Los otros caminos hacia acá (la pestaña Puntuar, "+ Agregar", editar una
      // nota vieja) no mandan la marca, así que ninguno cuenta: la pestaña
      // Puntuar es justamente una lista de cosas que ya vio.
      const pred = e.predicciones?.[item.key];
      if (pred && !pred.resuelta) {
        pred.resuelta = true;
        if (item.porRecomendacion === true) {
          e.aciertos = e.aciertos || [];
          e.aciertos.push({
            titulo: pred.titulo, prometido: pred.prob,
            nota: guardada.rating, acerto: guardada.rating >= 7,
            fecha: new Date().toISOString(),
          });
        } else {
          // Queda resuelta para que no siga contando como pendiente, pero fuera
          // del marcador. Se cuentan aparte para poder decir cuántas se dejaron
          // afuera y por qué.
          pred.yaLaHabiaVisto = true;
        }
      }
      guardarEstado(id, e);
      invalidar(id);
      return json(res, 200, { ok: true, item: guardada, total: D.cargar(id).length });
    }

    if (url.pathname === "/api/motivos" && req.method === "POST") {
      const id = usuarioDe(url, cuenta);
      const { key, motivos } = await cuerpo(req);
      const arr = D.cargar(id);
      const i = arr.findIndex(x => x.key === key);
      if (i < 0) return json(res, 400, { error: "Ese título no está en tus puntuaciones." });
      arr[i].motivos = D.normalizarMotivos(motivos);
      if (!arr[i].motivos.length) delete arr[i].motivos;
      D.grabar(id, arr);
      invalidar(id);
      return json(res, 200, {
        ok: true, motivos: arr[i].motivos || [], vocabulario: D.vocabularioDeMotivos(arr),
      });
    }

    // Lo que marcó "me la guardo": sin esto el botón no llevaba a ningún lado
    if (url.pathname === "/api/guardadas") {
      const id = usuarioDe(url, cuenta);
      const e = estadoDe(id);
      const lista = (await T.pool(e.guardadas || [], 6, async (key) => {
        const [kind, tid] = key.split(":");
        const d = await T.details(kind, +tid);
        if (!d) return null;
        const r = M.rasgos(d, kind);
        return {
          key, kind, tmdbId: +tid,
          titulo: d.title || d.name, anio: r.anio,
          duracion: r.dur, generos: r.generos, episodios: r.episodios,
          poster: d.poster_path ? "https://image.tmdb.org/t/p/w185" + d.poster_path : null,
          nota: d.vote_average, resumen: d.overview, imdb: d.imdb_id || null,
        };
      })).filter(Boolean);
      return json(res, 200, { lista });
    }

    // ¿Le achunta de verdad? Solo cuenta lo que le recomendó Y después puntuó.
    if (url.pathname === "/api/acierto") {
      const id = usuarioDe(url, cuenta);
      const e = estadoDe(id);
      const todos = e.aciertos || [];
      const altos = todos.filter(x => x.prometido >= 0.7);
      const resumen = (arr) => arr.length ? {
        total: arr.length,
        gustaron: arr.filter(x => x.acerto).length,
        prometido: Math.round(100 * arr.reduce((s2, x) => s2 + x.prometido, 0) / arr.length),
        real: Math.round(100 * arr.filter(x => x.acerto).length / arr.length),
      } : null;
      return json(res, 200, {
        todo: resumen(todos), sobre70: resumen(altos),
        ultimos: todos.slice(-12).reverse(),
        pendientes: Object.values(e.predicciones || {}).filter(p => !p.resuelta).length,
        // Las que puntuó pero YA había visto: quedan fuera del marcador a
        // propósito. Se informan para que el número de arriba se pueda auditar.
        yaLasHabiaVisto: Object.values(e.predicciones || {}).filter(p => p.yaLaHabiaVisto).length,
      });
    }

    if (url.pathname === "/api/despuntuar" && req.method === "POST") {
      const id = usuarioDe(url, cuenta);
      const { key } = await cuerpo(req);
      D.despuntuar(id, key);
      invalidar(id);
      return json(res, 200, { ok: true, total: D.cargar(id).length });
    }

    // ---- biblioteca ----
    if (url.pathname === "/api/biblioteca") {
      const id = usuarioDe(url, cuenta);
      const todas = D.cargar(id);
      const lista = D.filtrar(todas, {
        q: url.searchParams.get("q") || "",
        tipo: url.searchParams.get("tipo") || "todo",
        min: parseInt(url.searchParams.get("min"), 10) || 1,
        max: parseInt(url.searchParams.get("max"), 10) || 10,
        orden: url.searchParams.get("orden") || "puntaje",
        motivo: url.searchParams.get("motivo") || "",
      });
      // Póster y nota de TMDB: salen del perfil, que ya está en memoria con las
      // fichas completas. Cero llamadas a la API y ~200 ms la primera vez.
      const p = await perfilDe(id).catch(() => null);
      const fichas = new Map((p?.vistas || []).map(v => [v.key, v.d]));
      const conFoto = lista.map(x => {
        const d = fichas.get(x.key);
        return {
          ...x,
          poster: d?.poster_path ? "https://image.tmdb.org/t/p/w154" + d.poster_path : null,
          notaTmdb: d?.vote_average ? +d.vote_average.toFixed(1) : null,
          votosTmdb: d?.vote_count || null,
          generos: (d?.genres || []).slice(0, 2).map(g => g.name),
          motivos: x.motivos || [],
          imdb: d?.imdb_id || null,
        };
      });

      const conteo = {};
      for (const x of todas) conteo[x.rating] = (conteo[x.rating] || 0) + 1;
      return json(res, 200, {
        lista: conFoto, total: todas.length, mostrando: lista.length, conteo,
        pelis: todas.filter(x => x.kind === "movie").length,
        series: todas.filter(x => x.kind === "tv").length,
        vocabulario: D.vocabularioDeMotivos(todas),
        conMotivo: todas.filter(x => (x.motivos || []).length).length,
      });
    }

    // ---- gustos (preferencias) ----
    if (url.pathname === "/api/gustos" && req.method === "GET") {
      const id = usuarioDe(url, cuenta);
      return json(res, 200, { gustos: prefsDe(id), porDefecto: D.PREFS_POR_DEFECTO });
    }
    if (url.pathname === "/api/gustos/guardar" && req.method === "POST") {
      const id = usuarioDe(url, cuenta);
      const nuevo = await cuerpo(req);
      const actual = prefsDe(id);
      const num = (v, def) => (Number.isFinite(+v) ? +v : def);
      const lineas = (v) => Array.isArray(v)
        ? v.map(x => String(x).trim()).filter(Boolean)
        : String(v || "").split(/[\n,]/).map(x => x.trim()).filter(Boolean);

      const guardado = {
        ...actual,
        anioMinimo: num(nuevo.anioMinimo, actual.anioMinimo),
        notaMinimaViejas: num(nuevo.notaMinimaViejas, actual.notaMinimaViejas),
        notaMinima: num(nuevo.notaMinima, actual.notaMinima),
        penalizarEfectosViejos: num(nuevo.penalizarEfectosViejos, actual.penalizarEfectosViejos),
        votosMinimos: num(nuevo.votosMinimos, actual.votosMinimos),
        seriesTerminadas: !!nuevo.seriesTerminadas,
        maxEpisodios: num(nuevo.maxEpisodios, actual.maxEpisodios),
        bonusCapituloCorto: num(nuevo.bonusCapituloCorto, actual.bonusCapituloCorto),
        penalizarInfantil: num(nuevo.penalizarInfantil, actual.penalizarInfantil),
        penalizarAnimacionOccidental: num(nuevo.penalizarAnimacionOccidental, actual.penalizarAnimacionOccidental),
        penalizarFamilia: num(nuevo.penalizarFamilia, actual.penalizarFamilia),
        penalizarSoloHablada: num(nuevo.penalizarSoloHablada, actual.penalizarSoloHablada),
        confianzaMinima: num(nuevo.confianzaMinima, actual.confianzaMinima),
        evitarKeywords: lineas(nuevo.evitarKeywords),
        viendoAhora: lineas(nuevo.viendoAhora),
        yaVistas: lineas(nuevo.yaVistas),
        notas: String(nuevo.notas || ""),
      };
      D.escribir(D.rutasDe(id).preferencias, guardado);

      // Lo nuevo de "viendo ahora" / "ya vistas" hay que resolverlo a ids
      let marcadas = 0;
      try { marcadas = await marcarVistas(id); } catch { /* si TMDB falla, sigue */ }
      const e = estadoDe(id);
      e.mostradas = [];                      // las reglas cambiaron: cola limpia
      guardarEstado(id, e);
      return json(res, 200, { ok: true, gustos: guardado, marcadas });
    }

    // ---- cola para puntuar rápido lo que ya vio ----
    // Propone títulos populares que encajan con su perfil y que todavía no puntuó.
    // "No la vi" solo la saca de esta cola, no de las recomendaciones: que no la
    // haya visto es justamente motivo para recomendársela.
    if (url.pathname === "/api/para-puntuar") {
      const id = usuarioDe(url, cuenta);
      const p = await perfilDe(id);
      if (!p) return json(res, 200, { lista: [] });
      const e = estadoDe(id);
      const excl = new Set(p.vistas.map(v => v.key));
      for (const k of (e.saltadas || [])) excl.add(k);

      const tipo = url.searchParams.get("tipo");
      const kind = tipo === "movie" || tipo === "tv" ? tipo : null;
      const pagina = Math.max(0, parseInt(url.searchParams.get("pagina"), 10) || 0);

      // Sigue avanzando páginas hasta juntar 24 que no haya visto. Con 242
      // puntuadas y 25 salteadas, las primeras páginas ya están agotadas: si
      // dependía de que el front acertara la página, devolvía vacío.
      const crudos = [];
      const puestos = new Set();
      for (let salto = 0; salto < 8 && crudos.length < 24; salto++) {
        const lote = await M.candidatosAmplios(p.perfil, {
          excluir: excl, anioMinimo: null, tipo: kind,
          desde: 1 + (pagina + salto) * 4, paginas: 4,
        });
        for (const c of lote) {
          if ((c.votos || 0) < 800 || puestos.has(c.key)) continue;
          puestos.add(c.key);
          crudos.push(c);
        }
      }
      // Las más vistas primero: si vio algo, es más probable que sea de estas
      const lista = crudos
        .sort((a, b) => (b.votos || 0) - (a.votos || 0))
        .slice(0, 24)
        .map(c => ({
          key: c.key, kind: c.kind, tmdbId: c.tmdbId, titulo: c.titulo,
          anio: parseInt((c.fecha || "").slice(0, 4), 10) || null,
          poster: c.poster ? "https://image.tmdb.org/t/p/w185" + c.poster : null,
          nota: c.nota, votos: c.votos,
        }));
      return json(res, 200, { lista, saltadas: (e.saltadas || []).length, puntuadas: p.vistas.length });
    }

    if (url.pathname === "/api/saltar" && req.method === "POST") {
      const id = usuarioDe(url, cuenta);
      const { key } = await cuerpo(req);
      const e = estadoDe(id);
      e.saltadas = e.saltadas || [];
      if (!e.saltadas.includes(key)) e.saltadas.push(key);
      guardarEstado(id, e);
      return json(res, 200, { ok: true, saltadas: e.saltadas.length });
    }

    // ---- buscar para agregar algo nuevo ----
    if (url.pathname === "/api/buscar") {
      const q = url.searchParams.get("q") || "";
      if (q.trim().length < 2) return json(res, 200, { lista: [] });
      const s = await T.searchMulti(q.trim());
      const lista = (s?.results || [])
        .filter(x => x.media_type === "movie" || x.media_type === "tv")
        .slice(0, 12)
        .map(x => ({
          key: x.media_type + ":" + x.id, kind: x.media_type, tmdbId: x.id,
          titulo: x.title || x.name,
          anio: parseInt((x.release_date || x.first_air_date || "").slice(0, 4), 10) || null,
          poster: x.poster_path ? "https://image.tmdb.org/t/p/w185" + x.poster_path : null,
          votos: x.vote_count || 0,
        }));
      return json(res, 200, { lista });
    }

    // ---- exportar ----
    if (url.pathname === "/api/exportar") {
      const id = usuarioDe(url, cuenta);
      const formato = url.searchParams.get("formato") === "csv" ? "csv" : "txt";
      const arr = D.cargar(id);
      const texto = formato === "csv" ? D.exportarCsv(arr) : D.exportarTxt(arr);
      const nombre = "puntuaciones-" + id + "-" + new Date().toISOString().slice(0, 10) + "." + formato;
      res.writeHead(200, {
        "content-type": (formato === "csv" ? "text/csv" : "text/plain") + "; charset=utf-8",
        "content-disposition": 'attachment; filename="' + nombre + '"',
      });
      return res.end(texto);
    }

    if (url.pathname === "/api/feedback" && req.method === "POST") {
      const id = usuarioDe(url, cuenta);
      const { key, accion } = await cuerpo(req);
      const e = estadoDe(id);
      if (accion === "descartar" && !e.descartadas.includes(key)) e.descartadas.push(key);
      if (accion === "vista" && !e.vistas.includes(key)) e.vistas.push(key);
      if (accion === "guardar" && !e.guardadas.includes(key)) e.guardadas.push(key);
      if (accion === "sacar") e.guardadas = e.guardadas.filter(k => k !== key);
      guardarEstado(id, e);
      return json(res, 200, { ok: true });
    }

    // ---- pulso: qué tan rápida es esta máquina ----
    // Una búsqueda tarda 1 segundo en una compu y veinte en el hosting. Para
    // saber por qué hace falta medir la máquina, no la app: esto corre siempre
    // el mismo trabajo fijo y devuelve cuánto tardó. No lee datos de nadie.
    if (url.pathname === "/api/pulso") {
      if (url.searchParams.get("t") !== Auth.tokenDePulso()) {
        return json(res, 404, { error: "no existe" });
      }
      const medir = (fn) => { const t = Date.now(); fn(); return Date.now() - t; };

      // 1. CPU pura, en coma flotante: es lo que hace puntuar() y calibrar()
      const cpu = medir(() => {
        let x = 0;
        for (let i = 1; i < 6e6; i++) x += Math.sqrt(i) * 1.0000001;
        if (x < 0) console.log(x);            // que no lo optimice a la nada
      });

      // 2. Descomprimir, que es lo que agregué con el cache en Postgres
      const zlib = await import("node:zlib");
      const muestra = zlib.gzipSync(Buffer.from(JSON.stringify(
        { relleno: Array.from({ length: 4000 }, (_, i) => ({ i, t: "texto de relleno " + i })) })));
      const gunzip = medir(() => { for (let i = 0; i < 20; i++) zlib.gunzipSync(muestra); });

      // 3. scrypt, que es lo que corre al entrar
      const cryptoM = await import("node:crypto");
      const scrypt = medir(() => cryptoM.scryptSync("prueba", "sal", 64, { N: 16384, r: 8, p: 1 }));

      // 4. La base: ida y vuelta, y una lectura de a muchas
      let db = null, dbLote = null, entradas = null;
      if (A.backend() === "postgres") {
        const t1 = Date.now();
        for (let i = 0; i < 5; i++) await A.pingBase();
        db = Math.round((Date.now() - t1) / 5);
        const tam = await A.cacheTamanio();
        entradas = tam?.n ?? null;
        const claves = await A.cacheAlgunasClaves(100);
        const t2 = Date.now();
        await A.cacheLeerVarias(claves);
        dbLote = Date.now() - t2;
      }

      return json(res, 200, {
        node: process.version,
        cpus: os.cpus().length,
        modelo: os.cpus()[0]?.model || "?",
        memoriaMB: Math.round(process.memoryUsage().rss / 1e6),
        libreMB: Math.round(os.freemem() / 1e6),
        cargaPromedio: os.loadavg().map(x => +x.toFixed(2)),
        arribaHace: Math.round(process.uptime()) + "s",
        ms: { cpu, gunzip20: gunzip, scrypt, dbPing: db, dbLote100: dbLote },
        cacheEnLaBase: entradas,
        perfilesEnMemoria: perfiles.size,
        colasEnMemoria: colas.size,
      });
    }

    // ---- estáticos ----
    const file = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
    const full = path.join(DIR, "public", path.normalize(file));
    if (full.startsWith(path.join(DIR, "public")) && fs.existsSync(full) && fs.statSync(full).isFile()) {
      res.writeHead(200, { "content-type": MIME[path.extname(full)] || "application/octet-stream" });
      return res.end(fs.readFileSync(full));
    }
    await json(res, 404, { error: "no existe" });
  } catch (e) {
    // "NO_KEY" y "BAD_KEY" salen de tmdb.mjs y son mensajes para mí, no para el
    // que está del otro lado: sin traducir, entrar sin haber cargado la key daba
    // un 500 que decía "NO_KEY" y nada más.
    if (e.message === "NO_KEY") {
      return json(res, 400, { error: "Todavía no cargaste tu API key de TMDB.", faltaKey: true });
    }
    if (e.message === "BAD_KEY") {
      return json(res, 400, { error: "Tu API key de TMDB dejó de ser válida. Cargá una nueva.", faltaKey: true });
    }
    const codigo = (e instanceof UsuarioInvalido || e instanceof Auth.ErrorAuth) ? 400 : 500;
    await json(res, codigo, { error: e.message });
  }
}

// --- Calentar los perfiles al arrancar --------------------------------------
// Armar un perfil son ~284 pedidos a TMDB: con el cache lleno tarda un segundo,
// con el cache vacío tarda 37. Y en el hosting el cache vive en disco efímero,
// así que CADA reinicio arranca sin nada y esos 37 segundos se los comía el
// primero que entrara, creyendo que la app es lenta.
//
// Hacerlo de fondo al arrancar no los hace desaparecer: los corre mientras no
// hay nadie mirando. Va de a uno y no en paralelo, para no atropellar a TMDB.
async function calentarPerfiles() {
  const conPuntuaciones = D.todosLosUsuarios().filter(u => D.cargar(u.id).length);
  if (!conPuntuaciones.length) return;
  console.log("    calentando " + conPuntuaciones.length + " perfil(es) de fondo...");
  for (const u of conPuntuaciones.slice(0, 20)) {
    const key = u.cuenta ? Auth.keyTmdbDe(Auth.buscarCuenta(u.cuenta)) : config.tmdbKey;
    if (!key) continue;                        // sin key no hay nada que traer
    const t0 = Date.now();
    try {
      await T.conKey(key, () => perfilDe(u.id));
      console.log(`    ${u.nombre}: listo en ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (e) {
      console.error(`    ${u.nombre}: no pude armarlo (${e.message})`);
    }
  }
  console.log("    perfiles calientes.");
}

// --- No dormirse mientras la estás usando ------------------------------------
// El plan gratis apaga la instancia a los 15 minutos sin visitas, y despertarla
// tarda ~50 segundos. Peor: al reiniciar se borra el disco, así que el cache de
// TMDB arranca vacío y la primera búsqueda paga de nuevo.
//
// Esto la mantiene despierta pidiéndose una página a sí misma. Render cuenta
// horas de instancia, no visitas: te da 750 por mes y el mes tiene 730, así que
// tenerla despierta 24 horas entra JUSTO y sin margen. Por eso se hace por
// ventana horaria: de 9 a 1 son ~500 horas al mes, sobra lugar, y de madrugada
// se duerme cuando no la mira nadie.
//
// Se prende poniendo MANTENER_DESPIERTO con el rango, en hora argentina:
//     MANTENER_DESPIERTO=9-1
function mantenerDespierto() {
  const rango = process.env.MANTENER_DESPIERTO;
  const url = process.env.RENDER_EXTERNAL_URL;
  if (!rango || !url) return;

  const [desde, hasta] = rango.split("-").map(Number);
  if (!Number.isFinite(desde) || !Number.isFinite(hasta)) {
    console.log("    MANTENER_DESPIERTO mal escrito: se espera algo como 9-1");
    return;
  }
  const horaAca = () => +new Intl.DateTimeFormat("es-AR", {
    timeZone: process.env.ZONA_HORARIA || "America/Argentina/Buenos_Aires",
    hour: "numeric", hour12: false,
  }).format(new Date());
  // El rango puede cruzar la medianoche (9 a 1): ahí la comparación se da vuelta.
  const enHorario = () => {
    const h = horaAca();
    return desde <= hasta ? (h >= desde && h < hasta) : (h >= desde || h < hasta);
  };

  console.log(`    despierta de ${desde} a ${hasta} (hora argentina)`);
  setInterval(() => {
    if (!enHorario()) return;
    fetch(url + "/api/sesion").catch(() => { /* si falla, la próxima */ });
  }, 10 * 60e3).unref();     // unref: que esto solo no impida cerrar el proceso
}

function ipDeLaRed() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === "IPv4" && !i.internal) return i.address;
  }
  return null;
}

// Por defecto sólo localhost. En tu compu la app abre tus datos SIN pedir
// contraseña, así que atada a 0.0.0.0 cualquiera en el mismo WiFi —una red de
// un bar, la de la oficina— entra y los edita. Para el celular está la app
// publicada, que sí pide contraseña.
//
// El hosting necesita 0.0.0.0 o no le llega nada: eso se pide explícito con
// HOST, y está puesto en render.yaml. Que el default sea el lado cerrado es a
// propósito: si mañana me olvido de configurar algo, me quedo sin acceso
// remoto, no con los datos abiertos.
// El render.yaml también lo pone, pero un blueprint sólo se relee cuando lo
// sincronizás a mano: si el deploy sale sin la variable, el health check no
// llega nunca y el servicio se cae. Render exporta RENDER_EXTERNAL_URL en todos
// sus servicios —ya lo usa mantenerDespierto()—, así que eso alcanza para saber
// que estamos en el hosting aunque HOST no haya llegado.
const EN_RENDER = !!(process.env.RENDER
  || process.env.RENDER_EXTERNAL_URL || process.env.RENDER_SERVICE_ID);
const HOST = process.env.HOST || (EN_RENDER ? "0.0.0.0" : "127.0.0.1");

server.listen(PUERTO, HOST, () => {
  console.log("\n  Qué Ver");
  if (CON_LOGIN) {
    // De un vistazo tiene que quedar claro QUÉ datos estás mirando: los de la
    // nube o los de esta compu. Confundirlos es puntuar media hora en el lugar
    // equivocado. La cadena de conexión no se imprime NUNCA: trae la contraseña
    // de la base adentro y los logs de Render los ve cualquiera con acceso al
    // panel.
    const enLaNube = A.backend() === "postgres";
    console.log("    modo:      publicado (con cuentas)");
    console.log("    datos:     " + (enLaNube
      ? "la base de la nube — LO MISMO que ves en la web"
      : "archivos de data/ en esta compu"));
    console.log("    puerto:    " + PUERTO + (HOST === "0.0.0.0" ? "  (abierto a la red)" : "  (sólo esta compu)"));
    if (HOST !== "0.0.0.0") console.log("    entrás en:  http://localhost:" + PUERTO);
    console.log("    cuentas:   " + Auth.cantidadDeCuentas());
    // Solo publicado: en tu compu el cache sobrevive y no hace falta.
    mantenerDespierto();
    calentarPerfiles().catch(e => console.error("    calentar falló:", e.message));
  } else {
    console.log("    en esta compu:  http://localhost:" + PUERTO);
    // La dirección de la red sólo se anuncia si de verdad estamos escuchando
    // ahí. Antes se imprimía siempre, y con HOST cerrado mandaba al celular a
    // una puerta que no abre.
    const ip = HOST === "0.0.0.0" ? ipDeLaRed() : null;
    if (ip) console.log("    en el celular:  http://" + ip + ":" + PUERTO + "   (misma red WiFi, SIN contraseña)");
    console.log("    datos:          archivos de data/ en esta compu");
    console.log("    usuarios: " + D.listarUsuarios().map(u => u.nombre + " (" + D.cargar(u.id).length + ")").join(", "));
    if (!config.tmdbKey) console.log("\n    Falta la API key de TMDB. La cargás desde la web.");
  }
  console.log();
});

// Render manda SIGTERM antes de apagar: hay que dejar que la cola de escritura
// termine, o el último cambio que hiciste no llega nunca a la base.
for (const senal of ["SIGTERM", "SIGINT"]) {
  process.on(senal, async () => {
    server.close();
    await A.cerrar().catch(() => {});
    process.exit(0);
  });
}
