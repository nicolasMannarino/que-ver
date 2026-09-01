// Lectura de puntuaciones: export de IMDb (CSV) y bloc de notas suelto.
import fs from "node:fs";

// --- CSV real: comillas, comas adentro, saltos de linea escapados ---
export function parseCSV(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  const src = text.replace(/^\uFEFF/, "");           // saca el BOM de Excel
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r[0] || "").trim());
}

const norm = (s) => (s || "").trim().toLowerCase();

// Tipos de IMDb -> "movie" | "tv". Cubre exports viejos y nuevos.
function kindOf(titleType) {
  const t = norm(titleType).replace(/[\s_-]/g, "");
  if (t.includes("tvepisode")) return null;         // episodios sueltos no sirven
  if (t.includes("tv") && !t.includes("tvmovie")) return "tv";
  if (t.includes("series") || t.includes("miniseries")) return "tv";
  return "movie";
}

export function parseImdbCSV(text) {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const header = rows[0].map(norm);
  const col = (...names) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const iConst = col("const", "imdb id", "tconst");
  const iRating = col("your rating", "rating");
  const iTitle = col("title", "original title", "primary title");
  const iType = col("title type", "titletype");
  const iYear = col("year", "start year");
  const iGenres = col("genres");
  const iRuntime = col("runtime (mins)", "runtime (minutes)", "runtime");
  const iDirectors = col("directors", "director");
  if (iRating < 0 || (iConst < 0 && iTitle < 0)) return [];

  const out = [];
  for (const r of rows.slice(1)) {
    const rating = parseFloat(r[iRating]);
    if (!Number.isFinite(rating)) continue;
    const kind = kindOf(iType >= 0 ? r[iType] : "movie");
    if (!kind) continue;
    out.push({
      imdb: iConst >= 0 ? (r[iConst] || "").trim() : "",
      title: iTitle >= 0 ? (r[iTitle] || "").trim() : "",
      rating,
      kind,
      year: iYear >= 0 ? parseInt(r[iYear], 10) || null : null,
      genresRaw: iGenres >= 0 ? r[iGenres] : "",
      runtime: iRuntime >= 0 ? parseInt(r[iRuntime], 10) || null : null,
      directorsRaw: iDirectors >= 0 ? r[iDirectors] : "",
      source: "imdb",
    });
  }
  return out;
}

// --- Bloc de notas: tolerante. Acepta casi cualquier cosa con un numero al final ---
// "El Padrino 9"   "El Padrino - 9"   "El Padrino (1972): 9"   "9 - El Padrino"
// "El Padrino 8/10"   "El Padrino ....... 7,5"
export function parseNotepad(text) {
  const out = [];
  for (const raw of (text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^[-=*#_]{3,}$/.test(line)) continue;

    let title = null, rating = null, year = null;

    // Puntaje al final, con o sin /10
    let m = line.match(/^(.*?)[\s.:;,\-–—_]*(\d{1,2}(?:[.,]\d)?)\s*(?:\/\s*10)?\s*$/);
    if (m && m[1].trim()) { title = m[1]; rating = m[2]; }

    // Puntaje al principio: "9 - El Padrino"
    if (!title) {
      m = line.match(/^(\d{1,2}(?:[.,]\d)?)\s*(?:\/\s*10)?\s*[-–—:.\s]+(.+)$/);
      if (m) { rating = m[1]; title = m[2]; }
    }
    if (!title || rating === null) continue;

    rating = parseFloat(String(rating).replace(",", "."));
    if (!Number.isFinite(rating) || rating < 0 || rating > 10) continue;

    title = title.trim().replace(/^[-*•\d.)\s]+/, "").trim();

    // Año: entre parentesis manda. Suelto al final, solo si es plausible:
    // "Blade Runner 2049" es un titulo, no una peli del año 2049.
    let my = title.match(/^(.*?)\s*[([](\d{4})[)\]]\s*$/);
    if (!my) {
      const suelto = title.match(/^(.*?)\s+(19\d{2}|20\d{2})\s*$/);
      if (suelto && parseInt(suelto[2], 10) <= new Date().getFullYear() + 3) my = suelto;
    }
    if (my && my[1].trim()) { title = my[1].trim(); year = parseInt(my[2], 10); }
    title = title.replace(/[\s.:;,\-–—_]+$/, "").trim();
    if (!title || title.length < 2) continue;

    out.push({ imdb: "", title, rating, kind: null, year, source: "notepad" });
  }
  return out;
}

export function loadRatingsFile(file) {
  const text = fs.readFileSync(file, "utf8");
  const looksCSV = /(^|\n)[^\n]*,[^\n]*,/.test(text.slice(0, 2000)) && /your rating|const/i.test(text.slice(0, 2000));
  return looksCSV ? parseImdbCSV(text) : parseNotepad(text);
}

// Une varias fuentes sin duplicar. Gana la que tiene id de IMDb.
export function mergeRatings(lists) {
  const byImdb = new Map(), byTitle = new Map();
  for (const list of lists) {
    for (const r of list) {
      if (r.imdb) {
        const prev = byImdb.get(r.imdb);
        byImdb.set(r.imdb, prev ? { ...prev, ...r } : r);
      } else {
        const k = norm(r.title) + "|" + (r.year || "");
        if (!byTitle.has(k)) byTitle.set(k, r);
      }
    }
  }
  const titlesWithImdb = new Set([...byImdb.values()].map(r => norm(r.title)));
  const extras = [...byTitle.values()].filter(r => !titlesWithImdb.has(norm(r.title)));
  return [...byImdb.values(), ...extras];
}

// --- Formato agrupado: "10 Puntos: Titulo, Titulo, Titulo" ---
// Una linea abre el grupo y las siguientes lo continuan hasta el proximo puntaje.
export function parseAgrupado(text) {
  const out = [];
  let actual = null;
  for (const raw of (text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(\d{1,2}(?:[.,]\d)?)\s*(?:puntos?|pts?|estrellas?)\s*:?\s*(.*)$/i);
    let resto;
    if (m) { actual = parseFloat(m[1].replace(",", ".")); resto = m[2]; }
    else if (actual !== null) resto = line;
    else continue;
    if (!Number.isFinite(actual)) continue;

    for (let t of resto.split(",")) {
      t = t.trim().replace(/[.;]+$/, "").trim();
      if (t.length < 2) continue;
      let year = null;
      // Año solo si los parentesis del final tienen 4 digitos y nada mas
      const my = t.match(/^(.*?)\s*\((\d{4})\)\s*$/);
      if (my && my[1].trim()) { t = my[1].trim(); year = parseInt(my[2], 10); }
      out.push({ imdb: "", title: t, rating: actual, kind: null, year, source: "agrupado" });
    }
  }
  return out;
}

// Detecta el formato solo: agrupado, CSV de IMDb, o una linea por titulo.
export function parseAuto(text) {
  const cabeza = (text || "").slice(0, 3000);
  if (/your rating|^const,/im.test(cabeza)) return parseImdbCSV(text);
  if (/^\s*\d{1,2}\s*(puntos?|pts?|estrellas?)\s*:/im.test(cabeza)) return parseAgrupado(text);
  return parseNotepad(text);
}

// Variantes de busqueda para TMDB, de la mas prometedora a la menos.
// "El origen (Inception)" -> ["Inception", "El origen", "El origen (Inception)"]
// Los parentesis que no son titulo alternativo ("parte 2", "1") se descartan.
const NO_ES_TITULO = /^(parte|part|temporada|season|vol\.?|trilog|saga|completa?|r|\d+)\b/i;
export function variantesBusqueda(titulo) {
  const v = [];
  const m = titulo.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  if (m) {
    const base = m[1].trim(), dentro = m[2].trim();
    if (dentro.length > 2 && !NO_ES_TITULO.test(dentro)) v.push(dentro);
    if (base) v.push(base);
  }
  v.push(titulo.replace(/\s*\([^()]*\)\s*$/, "").trim());
  v.push(titulo);
  // Sin numeral suelto al final: "Harry Potter 3" -> "Harry Potter"
  const sinNum = titulo.replace(/\s+\d{1,2}\s*$/, "").trim();
  if (sinNum !== titulo && sinNum.length > 2) v.push(sinNum);
  return [...new Set(v.filter(x => x && x.length > 1))];
}

// Numero de secuela al final del titulo: "Harry Potter 3" -> 3, "Capitan America 2" -> 2.
// Solo cuenta el numero SUELTO al final, despues de sacar los parentesis.
// "(parte 2)" NO cuenta: ahi el 2 es la mitad de una pelicula partida, no la secuela.
export function numeroDeSecuela(titulo) {
  const sinParen = (titulo || "").replace(/\s*\([^()]*\)\s*$/, "").trim();
  const m = sinParen.match(/\s(\d{1,2})$/);
  if (m) {
    const n = parseInt(m[1], 10);
    return n >= 1 && n <= 20 ? n : null;
  }
  const rom = sinParen.match(/\s(?:parte|part)\s+(I{1,3}|IV|V|VI{0,3}|IX|X)$/i);
  if (rom) {
    const tabla = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };
    return tabla[rom[1].toUpperCase()] || null;
  }
  return null;
}
