// Usuarios y puntuaciones. Antes las puntuaciones vivían en un .txt que se
// importaba una vez; ahora son datos vivos, por usuario, que la app modifica.
// El .txt pasó a ser solo una forma de sembrar y de exportar.
// Las rutas dejaron de ser rutas de disco y pasaron a ser CLAVES del almacén
// ("usuarios/nico/puntuaciones.json"). En tu compu siguen siendo un archivo con
// ese nombre; en el hosting son una fila en Postgres. El resto del código no
// cambia porque la forma de la clave es la misma de siempre.
import * as A from "./almacen.mjs";

export const DATA = A.DATA;
const F_USUARIOS = "usuarios.json";

export const leer = A.leer;
export const escribir = A.escribir;

// Con qué arranca alguien que recién se anota. Eran MIS respuestas —nada de
// K-dramas, nada anterior al 2000 salvo que sea buenísima, los musicales abajo,
// nada de bucles temporales— metidas como el default de todo el mundo. Cualquiera
// que abriera la app heredaba mis manías sin haber dicho una palabra, y encima
// como varas duras: esas cosas no bajaban de puesto, desaparecían.
//
// Ahora el default es neutro: las reglas existen todas, pero apagadas. Las únicas
// que quedan prendidas son las que no son cuestión de gusto sino de no mostrar
// basura —un piso de nota y de votos— y las que salen de tus PROPIOS datos —los
// motivos con los que etiquetaste tus puntuaciones—. El resto se prende en Mis
// gustos, y ahí cada una dice qué hace.
//
// Ojo: esto también afloja las reglas de los que ya estaban, porque las que nunca
// tocaron se leen de acá. Es a propósito: eran justo las que hacían desaparecer
// títulos sin dejar rastro. La pantalla ahora cuenta cuántos tiró cada una.
export const PREFS_POR_DEFECTO = {
  _comentario: "Tus preferencias. Son las reglas que las puntuaciones no enseñan solas. Se editan desde «Mis gustos».",

  // --- Piso de calidad. Lo único prendido de entrada: no es gusto, es no ofrecer
  // cualquier cosa cuando quedan pocos candidatos. ---
  notaMinima: 6.0,
  votosMinimos: 100,
  confianzaMinima: 0.3,

  // --- Las viejas. anioMinimo marca desde cuándo es "vieja"; la vara y el
  // descuento arrancan en cero, o sea que una del 70 compite de igual a igual. ---
  anioMinimo: 2000,
  notaMinimaViejas: 0,
  penalizacionPreAnio: 0,
  excepcionPreAnioSiNota: 8.2,
  penalizarEfectosViejos: 0,

  // --- Series. Apagadas: hay gente que las quiere largas y en emisión. ---
  seriesTerminadas: false,
  penalizacionSerieAbierta: 0,
  maxEpisodios: 60,
  penalizacionEpisodios: 0,
  bonusCapituloCorto: 0,
  episodiosSoloMuyBuenas: 0,
  minutosCapituloLargas: 30,
  notaMinimaLargas: 8.5,
  votosMinimosLargas: 2500,

  // --- Animación. El motor no sabe solo que tus dieces de dibujitos son de la
  // infancia: si te pasa, se prende acá. ---
  penalizarInfantil: 0,
  penalizarAnimacionOccidental: 0,
  penalizarFamilia: 0,

  // --- Idiomas que solo mirás si están muy buenas. Vacío = ninguno. ---
  idiomasSoloMuyBuenas: [],
  notaMinimaIdioma: 8.0,
  votosMinimosIdioma: 2500,

  // --- Ciencia ficción vieja, por los efectos. 0 años = apagada. ---
  aniosSciFiVieja: 0,
  notaMinimaSciFiVieja: 8.5,
  votosMinimosSciFiVieja: 2500,

  // --- Gustos sueltos. Todos en cero: son manías, no reglas. ---
  penalizarMusical: 0,
  penalizarSoloHablada: 0,
  evitarKeywords: [],
  penalizacionEvitar: 1.5,

  // --- Esto sí sale de tus datos: los motivos con los que etiquetaste tus propias
  // puntuaciones ("lenta", "predecible"). Sin etiquetas no hace nada. ---
  penalizarMotivos: 1.5,

  viendoAhora: [],
  yaVistas: [],
};

// --- Usuarios ---
export function slug(nombre) {
  return (nombre || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "usuario";
}

// Todos los perfiles de todas las cuentas viven en la misma lista, cada uno con
// el id de su cuenta. Sin cuenta = instalación local de un solo dueño, que es
// como venía funcionando y como sigue funcionando en tu compu.
export const todosLosUsuarios = () => leer(F_USUARIOS, null) || [];

export function listarUsuarios(cuenta = null) {
  const l = todosLosUsuarios();
  // Nunca devuelvas el perfil de otro: el filtro por cuenta es la línea que
  // separa los datos de una persona de los de la de al lado.
  return cuenta ? l.filter(u => u.cuenta === cuenta) : l.filter(u => !u.cuenta);
}

export function rutasDe(id) {
  const base = "usuarios/" + id;
  return {
    base: base + "/",
    puntuaciones: base + "/puntuaciones.json",
    estado: base + "/estado.json",
    preferencias: base + "/preferencias.json",
    mapeo: base + "/mapeo.json",
  };
}

export function crearUsuario(nombre, cuenta = null) {
  // El id es único entre TODOS los perfiles, no solo entre los de esta cuenta:
  // es la clave del almacén, y dos cuentas con un perfil "papa" cada una se
  // estarían escribiendo encima.
  const todos = todosLosUsuarios();
  let id = slug(nombre), n = 2;
  while (todos.some(u => u.id === id)) id = slug(nombre) + "-" + n++;
  const r = rutasDe(id);
  if (!A.existe(r.puntuaciones)) escribir(r.puntuaciones, []);
  if (!A.existe(r.preferencias)) escribir(r.preferencias, PREFS_POR_DEFECTO);
  if (!A.existe(r.estado)) escribir(r.estado, { descartadas: [], vistas: [], guardadas: [], mostradas: [] });
  if (!A.existe(r.mapeo)) escribir(r.mapeo, {});
  const entrada = { id, nombre: (nombre || "").trim() || id };
  if (cuenta) entrada.cuenta = cuenta;

  // El id se eligió contra la lista que tenía este proceso, que con dos
  // instancias puede estar vieja: si la otra creó un "papa" hace medio segundo,
  // acá figura libre. Por eso la decisión final se toma contra lo que hay EN LA
  // BASE, y si el id ya está tomado NO se agrega la entrada.
  //
  // Falla del lado seguro a propósito: sin entrada en usuarios.json, usuarioDe()
  // no le autoriza ese perfil a esta cuenta, así que nadie termina leyendo y
  // escribiendo las puntuaciones de otro. Los archivos de arriba tampoco se
  // pisan, porque cada uno va sólo si no existía. Queda un perfil que no se
  // creó — se vuelve a intentar con otro nombre — en vez de dos cuentas
  // compartiendo datos sin saberlo.
  A.mutar(F_USUARIOS, (lista) => (lista.some(u => u.id === id) ? lista : [...lista, entrada]), []);
  return id;
}

export function borrarUsuario(id) {
  // Sacar por id es re-aplicable tal cual sobre lo que haya en la base, así que
  // el borrado no se lleva puesto un perfil que la otra instancia agregó.
  A.mutar(F_USUARIOS, (lista) => lista.filter(u => u.id !== id), []);
  A.borrarPrefijo(rutasDe(id).base);
}

// Mueve la instalación de un solo usuario al layout nuevo. Corre una vez.
export function migrar(nombrePorDefecto = "Yo") {
  if (todosLosUsuarios().length) return null;
  const id = crearUsuario(nombrePorDefecto);
  const r = rutasDe(id);
  for (const [viejo, nuevo] of [
    ["estado.json", r.estado],
    ["preferencias.json", r.preferencias],
    ["mapeo.json", r.mapeo],
  ]) {
    const contenido = leer(viejo, null);
    if (contenido && !leer(nuevo, null)?.length) escribir(nuevo, contenido);
  }
  // El perfil viejo trae las puntuaciones ya resueltas: las convierto al store
  const perfilViejo = leer("perfil.json", null);
  if (perfilViejo?.vistas?.length) {
    escribir(r.puntuaciones, perfilViejo.vistas.map(v => ({
      key: v.key, kind: v.kind, tmdbId: v.tmdbId,
      titulo: v.titulo, anio: v.anio || null,
      rating: v.rating, fecha: perfilViejo.fecha || new Date().toISOString(),
    })));
  }
  return id;
}

// --- Puntuaciones ---
export const cargar = (id) => leer(rutasDe(id).puntuaciones, []);
export const grabar = (id, arr) => escribir(rutasDe(id).puntuaciones, arr);

export function puntuar(id, item) {
  const arr = cargar(id);
  const i = arr.findIndex(x => x.key === item.key);
  const entrada = {
    key: item.key, kind: item.kind, tmdbId: item.tmdbId,
    titulo: item.titulo, anio: item.anio ?? null,
    rating: Math.max(1, Math.min(10, Number(item.rating))),
    fecha: new Date().toISOString(),
  };
  // Los motivos los escribe él con SUS palabras. Yo había puesto "lenta" y me
  // dijo que a varias les pondría "mal llevada", que es otra cosa. Si las
  // categorías las invento yo, la señal sale sucia.
  if (item.motivos !== undefined) entrada.motivos = normalizarMotivos(item.motivos);
  else if (i >= 0 && arr[i].motivos) entrada.motivos = arr[i].motivos;
  if (i >= 0) arr[i] = { ...arr[i], ...entrada };
  else arr.push(entrada);
  grabar(id, arr);
  return entrada;
}

export function despuntuar(id, key) {
  const arr = cargar(id).filter(x => x.key !== key);
  grabar(id, arr);
}

const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Un motivo es una o dos palabras suyas. Los guardo normalizados para que
// "Mal llevada" y "mal llevada " sean el mismo.
export function normalizarMotivos(v) {
  const SEPARADORES = new RegExp("[,;" + String.fromCharCode(10) + "]");
  const bruto = Array.isArray(v) ? v : String(v || "").split(SEPARADORES);
  const vistos = new Set();
  const out = [];
  for (const x of bruto) {
    const t = String(x).trim().replace(/\s+/g, " ").toLowerCase().slice(0, 30);
    if (t.length < 2 || vistos.has(t)) continue;
    vistos.add(t);
    out.push(t);
  }
  return out.slice(0, 4);
}

// Migra la marca vieja de "lenta" al formato nuevo
export function migrarLentas(id) {
  const arr = cargar(id);
  let tocadas = 0;
  for (const x of arr) {
    if (x.lenta && !x.motivos) { x.motivos = ["lenta"]; tocadas++; }
    delete x.lenta;
  }
  if (tocadas) grabar(id, arr);
  return tocadas;
}

// Qué motivos usó y cuántas veces: es su vocabulario, no el mío
export function vocabularioDeMotivos(arr) {
  const cuenta = new Map();
  for (const x of arr) for (const m of (x.motivos || [])) cuenta.set(m, (cuenta.get(m) || 0) + 1);
  return [...cuenta.entries()].sort((a, b) => b[1] - a[1]).map(([motivo, n]) => ({ motivo, n }));
}

export function filtrar(arr, { q = "", tipo = "todo", min = 1, max = 10, orden = "puntaje", motivo = "" } = {}) {
  const t = norm(q).trim();
  let out = arr.filter(x =>
    (tipo === "todo" || x.kind === tipo) &&
    x.rating >= min && x.rating <= max &&
    (!motivo || (x.motivos || []).includes(motivo)) &&
    (!t || norm(x.titulo).includes(t)));
  const cmp = {
    puntaje: (a, b) => b.rating - a.rating || norm(a.titulo).localeCompare(norm(b.titulo)),
    titulo: (a, b) => norm(a.titulo).localeCompare(norm(b.titulo)),
    anio: (a, b) => (b.anio || 0) - (a.anio || 0),
    reciente: (a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")),
  };
  return out.sort(cmp[orden] || cmp.puntaje);
}

// --- Exportar al mismo formato de bloc de notas que usa él ---
export function exportarTxt(arr) {
  const porNota = new Map();
  for (const x of [...arr].sort((a, b) => norm(a.titulo).localeCompare(norm(b.titulo)))) {
    if (!porNota.has(x.rating)) porNota.set(x.rating, []);
    porNota.get(x.rating).push(x.titulo);
  }
  const lineas = [];
  for (const nota of [...porNota.keys()].sort((a, b) => b - a)) {
    lineas.push(`${nota} ${nota === 1 ? "Punto" : "Puntos"}: ${porNota.get(nota).join(", ")}`);
    lineas.push("");
  }
  return lineas.join("\n").trim() + "\n";
}

export function exportarCsv(arr) {
  const esc = (s) => /[",\n]/.test(String(s)) ? '"' + String(s).replace(/"/g, '""') + '"' : String(s);
  const filas = [["titulo", "puntaje", "tipo", "anio", "tmdb_id", "fecha"].join(",")];
  for (const x of [...arr].sort((a, b) => b.rating - a.rating)) {
    filas.push([x.titulo, x.rating, x.kind === "tv" ? "serie" : "pelicula",
                x.anio || "", x.tmdbId, (x.fecha || "").slice(0, 10)].map(esc).join(","));
  }
  return filas.join("\n") + "\n";
}
