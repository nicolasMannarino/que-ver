// Usuarios y puntuaciones. Antes las puntuaciones vivían en un .txt que se
// importaba una vez; ahora son datos vivos, por usuario, que la app modifica.
// El .txt pasó a ser solo una forma de sembrar y de exportar.
import fs from "node:fs";
import path from "node:path";

const DIR = import.meta.dirname;
export const DATA = path.join(DIR, "data");
const USUARIOS = path.join(DATA, "usuarios");
const F_USUARIOS = path.join(DATA, "usuarios.json");

export const leer = (f, def) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return def; } };
export const escribir = (f, v) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(v, null, 2));
};

export const PREFS_POR_DEFECTO = {
  _comentario: "Tus preferencias. Son las reglas que las puntuaciones no enseñan solas. Se releen en cada búsqueda: editás y recargás la página.",
  anioMinimo: 2000,
  penalizacionPreAnio: 0.9,
  excepcionPreAnioSiNota: 8.2,
  notaMinimaViejas: 8.0,
  penalizarEfectosViejos: 1.2,
  notaMinima: 6.4,
  votosMinimos: 150,
  seriesTerminadas: true,
  penalizacionSerieAbierta: 0.8,
  maxEpisodios: 60,
  penalizacionEpisodios: 0.8,
  bonusCapituloCorto: 0.25,
  penalizarInfantil: 2.2,
  penalizarAnimacionOccidental: 1.6,
  penalizarFamilia: 1.4,
  penalizarMotivos: 1.5,
  confianzaMinima: 0.3,
  evitarKeywords: ["time loop", "nonlinear timeline", "amnesia", "memory loss"],
  penalizacionEvitar: 1.5,
  viendoAhora: [],
  yaVistas: [],
};

// --- Usuarios ---
export function slug(nombre) {
  return (nombre || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "usuario";
}

export function listarUsuarios() {
  const l = leer(F_USUARIOS, null);
  if (l?.length) return l;
  return [];
}

export function rutasDe(id) {
  const base = path.join(USUARIOS, id);
  return {
    base,
    puntuaciones: path.join(base, "puntuaciones.json"),
    estado: path.join(base, "estado.json"),
    preferencias: path.join(base, "preferencias.json"),
    mapeo: path.join(base, "mapeo.json"),
  };
}

export function crearUsuario(nombre) {
  const lista = listarUsuarios();
  let id = slug(nombre), n = 2;
  while (lista.some(u => u.id === id)) id = slug(nombre) + "-" + n++;
  const r = rutasDe(id);
  fs.mkdirSync(r.base, { recursive: true });
  if (!fs.existsSync(r.puntuaciones)) escribir(r.puntuaciones, []);
  if (!fs.existsSync(r.preferencias)) escribir(r.preferencias, PREFS_POR_DEFECTO);
  if (!fs.existsSync(r.estado)) escribir(r.estado, { descartadas: [], vistas: [], guardadas: [], mostradas: [] });
  if (!fs.existsSync(r.mapeo)) escribir(r.mapeo, {});
  lista.push({ id, nombre: (nombre || "").trim() || id });
  escribir(F_USUARIOS, lista);
  return id;
}

export function borrarUsuario(id) {
  const lista = listarUsuarios().filter(u => u.id !== id);
  escribir(F_USUARIOS, lista);
  try { fs.rmSync(rutasDe(id).base, { recursive: true, force: true }); } catch { /* da igual */ }
}

// Mueve la instalación de un solo usuario al layout nuevo. Corre una vez.
export function migrar(nombrePorDefecto = "Nico") {
  if (listarUsuarios().length) return null;
  const id = crearUsuario(nombrePorDefecto);
  const r = rutasDe(id);
  for (const [viejo, nuevo] of [
    ["estado.json", r.estado],
    ["preferencias.json", r.preferencias],
    ["mapeo.json", r.mapeo],
  ]) {
    const p = path.join(DATA, viejo);
    if (fs.existsSync(p) && !leer(nuevo, null)?.length) {
      try { fs.copyFileSync(p, nuevo); } catch { /* seguimos */ }
    }
  }
  // El perfil viejo trae las puntuaciones ya resueltas: las convierto al store
  const perfilViejo = leer(path.join(DATA, "perfil.json"), null);
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
