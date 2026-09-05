// El motor: arma el perfil de gusto, genera candidatos y los ordena.
// Regla de diseño: el LLM nunca INVENTA títulos. Los candidatos salen de TMDB
// y el filtro de "ya vistas" es código, no prompt. Ese era el bug de Gemini.
import * as T from "./tmdb.mjs";
import { variantesBusqueda, numeroDeSecuela } from "./ratings.mjs";

const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// "Harry Potter 3" no existe como título en TMDB. Pero si "Harry Potter" cae en
// una colección, la tercera por fecha de estreno SÍ es la que busca.
async function porColeccion(id, n) {
  const d = await T.details("movie", id);
  const col = d?.belongs_to_collection?.id;
  if (!col) return null;
  const c = await T.coleccion(col);
  const partes = (c?.parts || [])
    .filter(x => x.release_date)
    .sort((a, b) => a.release_date.localeCompare(b.release_date));
  return partes[n - 1]?.id || null;
}

// --- 1. Resolver cada puntuación a una ficha real de TMDB ---
// Prueba varias formas del título: "El origen (Inception)" busca primero
// "Inception", que es como TMDB lo tiene indexado.
export async function resolver(ratings, onProgress, mapeo = {}) {
  let hechas = 0;
  const claves = new Map(Object.entries(mapeo).map(([k, v]) => [norm(k), v]));

  const res = await T.pool(ratings, 8, async (r) => {
    let kind = r.kind, id = null, usado = null;

    // 1. Corrección a mano (data/mapeo.json) — gana sobre todo lo demás
    const fijo = claves.get(norm(r.title));
    if (fijo) {
      const m = String(fijo).match(/^(movie|tv):(\d+)$/);
      if (m) {
        onProgress?.(++hechas, ratings.length);
        return { ...r, kind: m[1], tmdbId: +m[2], key: fijo, buscadoComo: "mapeo.json" };
      }
      r = { ...r, title: String(fijo) };   // si no es un id, es un mejor término de búsqueda
    }

    if (r.imdb) {
      const f = await T.findByImdb(r.imdb);
      if (f?.movie_results?.length) { kind = "movie"; id = f.movie_results[0].id; }
      else if (f?.tv_results?.length) { kind = "tv"; id = f.tv_results[0].id; }
    }

    if (!id && r.title) {
      for (const variante of variantesBusqueda(r.title)) {
        const s = await T.searchMulti(variante, r.year || undefined);
        let cands = (s?.results || []).filter(x => x.media_type === "movie" || x.media_type === "tv");
        if (!cands.length) continue;
        if (r.year) {
          const delAnio = cands.filter(x => {
            const y = parseInt((x.release_date || x.first_air_date || "").slice(0, 4), 10);
            return y && Math.abs(y - r.year) <= 1;
          });
          if (delAnio.length) cands = delAnio;
        }
        // Comparo contra el título traducido Y el original: buscando "Game of
        // Thrones", TMDB en español devuelve "Juego de tronos" y nunca matcheaba.
        const titulosDe = (x) => [x.title, x.name, x.original_title, x.original_name]
          .filter(Boolean).map(norm);
        // Puntaje = cuánta gente la vio + un premio por título exacto. Nunca
        // popularidad: mide lo que está de moda esta semana y elige el remake
        // (Avatar 2024) o el spin-off (La casa del dragón le ganaba a Game of
        // Thrones 172 a 165 con la cuarta parte de votos).
        // El premio por exacto NO puede ser absoluto: "Contra lo imposible"
        // matcheaba palabra por palabra con una de 2025 con CERO votos en vez
        // de Ford v Ferrari, que tiene 9238.
        const puntaje = (x) =>
          Math.log10(1 + (x.vote_count || 0)) + (titulosDe(x).includes(norm(variante)) ? 1.5 : 0);
        const elegido = [...cands].sort((a, b) => puntaje(b) - puntaje(a))[0];
        kind = elegido.media_type; id = elegido.id; usado = variante;
        break;
      }

      // "Harry Potter 3": el número no está en ningún título, está en la colección
      const n = numeroDeSecuela(r.title);
      if (n && kind === "movie" && id) {
        const dela = await porColeccion(id, n).catch(() => null);
        if (dela) { id = dela; usado = (usado || r.title) + " → nº " + n + " de la colección"; }
      }
    }

    onProgress?.(++hechas, ratings.length);
    if (!id) return null;
    return { ...r, kind, tmdbId: id, key: kind + ":" + id, buscadoComo: usado };
  });
  return res.filter(Boolean);
}

// Dos títulos distintos no pueden ser la misma ficha: si pasa, uno se resolvió mal.
// Me quedo con el que más se parece y devuelvo el resto para avisarle.
export function quitarColisiones(items) {
  const porKey = new Map();
  for (const it of items) {
    const prev = porKey.get(it.key);
    if (!prev) { porKey.set(it.key, it); continue; }
    const parecido = (x) => {
      const t = norm(x.d?.title || x.d?.name || "");
      const q = norm(x.title);
      return t === q ? 2 : (t.includes(q) || q.includes(t)) ? 1 : 0;
    };
    if (parecido(it) > parecido(prev)) porKey.set(it.key, it);
  }
  const buenos = new Set([...porKey.values()]);
  return {
    limpios: [...buenos],
    colisiones: items.filter(x => !buenos.has(x)).map(x => x.title),
  };
}

// Extrae las señales de una ficha: géneros, keywords, gente, época, idioma
export function rasgos(d, kind) {
  const kwRaw = d.keywords?.keywords || d.keywords?.results || [];
  const kw = kwRaw.map(k => "kw:" + k.id);
  const kwNames = kwRaw.map(k => (k.name || "").toLowerCase());
  const gen = (d.genres || []).map(g => "gen:" + g.id);
  const crew = d.credits?.crew || [];
  const dir = crew.filter(c => c.job === "Director" || c.job === "Creator").map(c => "dir:" + c.id);
  const escritor = crew.filter(c => c.department === "Writing").slice(0, 2).map(c => "wri:" + c.id);
  const cast = (d.credits?.cast || []).slice(0, 6).map(c => "act:" + c.id);
  const fecha = d.release_date || d.first_air_date || "";
  const anio = parseInt(fecha.slice(0, 4), 10) || null;
  const decada = anio ? ["dec:" + Math.floor(anio / 10) * 10] : [];
  const idioma = d.original_language ? ["lang:" + d.original_language] : [];
  const dur = kind === "movie" ? (d.runtime || null) : (d.episode_run_time?.[0] || null);
  return {
    features: [...gen, ...kw, ...dir, ...escritor, ...cast, ...decada, ...idioma],
    kwNames, anio, dur,
    coleccion: d.belongs_to_collection?.id || null,
    votos: d.vote_count || 0, nota: d.vote_average || 0,
    status: d.status || null,
    episodios: d.number_of_episodes || null,
    temporadas: d.number_of_seasons || null,
    generos: (d.genres || []).map(g => g.name),
    // Los ids ademas de los nombres: filtrar por genero se hace por id
    // (los nombres cambian con el idioma) y hace falta del lado del server.
    generosIds: (d.genres || []).map(g => g.id),
  };
}

export async function fichas(items, onProgress) {
  let hechas = 0;
  const out = await T.pool(items, 8, async (it) => {
    const d = await T.details(it.kind, it.tmdbId);
    onProgress?.(++hechas, items.length);
    if (!d) return null;
    return { ...it, d, ...rasgos(d, it.kind) };
  });
  return out.filter(Boolean);
}

// --- 2. Perfil de gusto ---
// Cada rasgo suma el peso de las pelis donde aparece. Peso = cuánto se despega
// de SU promedio (no del promedio de la gente). Lo que puntuó bajo, resta.
// Motivos que marcan "esto lo vi en otra época de mi vida"
const NOSTALGIA = new Set(["de chico", "de chica", "de pibe", "nostalgia", "de niño"]);

// "Esta nota no me representa": el título sale del perfil ENTERO. No pesa, no es
// vecino y no puede ser semilla. La nota queda en su lista — Toy Story 10 es cierto
// — pero deja de opinar sobre lo que se le ofrece hoy.
//
// Hace falta porque "de chico" (que pesa 0.35) no alcanzaba: de sus 30 animadas no
// japonesas, 12 no estaban etiquetadas y pesaban completo. Entre las 37 animadas
// promedian 8.24 contra su media de 7.15, y el género Animación terminó con peso
// 2.882 — uno de los rasgos más fuertes de todo su perfil. Con la vara alta, el
// 100% de lo que pasaba era animado, y destildar "Sin animación" lo dejaba en cero.
const NO_CUENTA = new Set(["no cuenta", "no tener en cuenta", "no me representa"]);
export const noCuenta = (v) => (v.motivos || []).some(x => NO_CUENTA.has(x));

export function perfil(todas) {
  // Lo marcado "no tener en cuenta" se va antes de calcular nada: si quedara para
  // la media o el desvío seguiría moviendo el z-score de todo lo demás.
  const vistas = todas.filter(v => !noCuenta(v));
  const notas = vistas.map(v => v.rating);
  const media = notas.reduce((a, b) => a + b, 0) / (notas.length || 1);
  const desvio = Math.sqrt(notas.reduce((a, b) => a + (b - media) ** 2, 0) / (notas.length || 1)) || 1;

  const pesos = new Map(), cuenta = new Map();
  for (const v of vistas) {
    // "De chico" no borra la nota — Toy Story 10 es cierto — pero no puede mandar
    // en lo que le ofrezco hoy. Cuenta un tercio.
    const nostalgia = (v.motivos || []).some(x => NOSTALGIA.has(x)) ? 0.35 : 1;
    const w = nostalgia * (v.rating - media) / desvio;   // z-score: +alto le gustó, -bajo no
    for (const f of v.features) {
      pesos.set(f, (pesos.get(f) || 0) + w);
      cuenta.set(f, (cuenta.get(f) || 0) + 1);
    }
  }
  // Normalizo por raíz de frecuencia: "Drama" aparece en todo y no dice nada
  const score = new Map();
  for (const [f, p] of pesos) score.set(f, p / Math.sqrt(cuenta.get(f)));

  // Semillas: las que más le gustaron, pero SIN que una saga se lleve la mitad.
  // Con 6 Harry Potter y 3 Toy Story arriba, todo lo recomendado terminaba siendo
  // la secuela que falta de algo que ya vio.
  // Y tampoco un género: con 5 animadas entre los dieces, el vecindario Disney
  // es tan denso en TMDB que se comía la lista entera.
  const colecciones = new Set(vistas.map(v => v.coleccion).filter(Boolean));
  const usoColeccion = new Map(), usoGenero = new Map();
  const gustadas = [];
  const candidatasSemilla = vistas
    .filter(v => v.rating >= media + 0.3)
    .filter(v => !(v.motivos || []).some(x => NOSTALGIA.has(x)))
    .sort((a, b) => b.rating - a.rating);
  for (const v of candidatasSemilla) {
    if (v.coleccion) {
      const n = usoColeccion.get(v.coleccion) || 0;
      if (n >= 2) continue;                      // como mucho 2 pelis por saga
      usoColeccion.set(v.coleccion, n + 1);
    }
    const g = (v.generos || [])[0];
    if (g) {
      const n = usoGenero.get(g) || 0;
      if (n >= 5) continue;                      // como mucho 5 semillas por género
      usoGenero.set(g, n + 1);
    }
    gustadas.push(v);
  }

  const votosMedios = gustadas.length
    ? gustadas.reduce((a, v) => a + Math.log10(1 + v.votos), 0) / gustadas.length : 3;
  const duraciones = gustadas.map(v => v.dur).filter(Boolean);
  const durMedia = duraciones.length ? duraciones.reduce((a, b) => a + b, 0) / duraciones.length : 110;

  // Para la afinidad por vecinos: cada título suyo como conjunto de rasgos + peso
  const vecinos = vistas.map(v => ({
    set: new Set(v.features), w: (v.rating - media) / desvio,
    titulo: v.titulo || v.d?.title || v.d?.name || v.title,
  }));

  // Un perfil por cada motivo que él escribió, no por categorías mías. Qué
  // rasgos aparecen más en las que marcó con ese motivo que en el resto.
  // Es la única forma de capturar cosas como "lenta" o "mal llevada": TMDB no
  // tiene ningún campo que las mida.
  const frecTodo = new Map();
  for (const v of vistas) for (const f of new Set(v.features)) frecTodo.set(f, (frecTodo.get(f) || 0) + 1);

  const porMotivo = new Map();
  for (const v of vistas) {
    for (const mot of (v.motivos || [])) {
      if (!porMotivo.has(mot)) porMotivo.set(mot, []);
      porMotivo.get(mot).push(v);
    }
  }
  const perfilesMotivo = new Map();
  for (const [mot, marcadas] of porMotivo) {
    if (marcadas.length < 3) continue;              // con menos no hay patrón, hay ruido
    // "De chico" NO es "no me gustó": es "esta nota es de otra época". Ya pesa un
    // tercio en el perfil; usarla además como castigo mezcla dos cosas distintas.
    // A la animación occidental la baja su propia regla, que es explícita.
    if (NOSTALGIA.has(mot)) continue;
    const frec = new Map();
    for (const v of marcadas) for (const f of new Set(v.features)) frec.set(f, (frec.get(f) || 0) + 1);
    const perfil = new Map();
    for (const [f, n] of frec) {
      if (n < 2) continue;                          // un solo caso no es patrón
      if (f.startsWith("gen:") || f.startsWith("dec:")) continue;   // "Drama" está en el 40%
      const pMot = n / marcadas.length;
      const pTodo = (frecTodo.get(f) || 0) / vistas.length;
      if (pTodo > 0.15) continue;                   // solo rasgos específicos, no ubicuos
      if (pMot > pTodo * 1.6) perfil.set(f, pMot - pTodo);
    }
    if (perfil.size) perfilesMotivo.set(mot, perfil);
  }

  return { media, desvio, score, gustadas, colecciones, vecinos, perfilesMotivo,
           motivosUsados: [...porMotivo.entries()].map(([m, xs]) => [m, xs.length]),
           votosMedios, durMedia, total: vistas.length };
}

// "¿A cuáles de las suyas se parece?" — medido con backtest contra sus propias
// puntuaciones, esto predice mejor que la afinidad de rasgos sola:
// AUC 0.751 contra 0.724, Spearman 0.442 contra 0.393.
export function afinidadVecinos(p, features, k = 20, devolverMasParecida = false) {
  if (!p.vecinos?.length || !features?.length) return devolverMasParecida ? null : 0;
  const mios = new Set(features);
  const sims = [];
  for (const o of p.vecinos) {
    let inter = 0;
    for (const f of mios) if (o.set.has(f)) inter++;
    if (!inter) continue;
    sims.push({ jac: inter / (mios.size + o.set.size - inter), w: o.w, titulo: o.titulo });
  }
  if (!sims.length) return devolverMasParecida ? null : 0;
  sims.sort((a, b) => b.jac - a.jac);
  if (devolverMasParecida) return sims[0].titulo || null;
  const top = sims.slice(0, k);
  const peso = top.reduce((s, x) => s + x.jac, 0) || 1;
  return top.reduce((s, x) => s + x.jac * x.w, 0) / peso;
}

// Ofrecerle la 2 de una saga que no empezó es ofrecerle algo que no puede ver:
// él lo dijo viendo Animales Fantásticos 2 y 3 en la lista, sin la 1 por ningún
// lado. Devuelve el set de ids que NO son la primera de su colección, para las
// colecciones de las que él no puntuó nada. Va aparte de filtrar() porque necesita
// pedirle a TMDB las colecciones, y filtrar() es sincrónico.
export async function secuelasHuerfanas(cands, p) {
  const cols = new Map();          // coleccion -> [candidatos con esa coleccion]
  for (const c of cands) {
    const col = c.detalle?.coleccion;
    if (!col || p.colecciones.has(col)) continue;   // si ya vio algo de la saga, filtrar() ya la sacó
    if (!cols.has(col)) cols.set(col, []);
    cols.get(col).push(c);
  }
  const fuera = new Set();
  await T.pool([...cols.keys()], 6, async (col) => {
    const d = await T.coleccion(col);
    const partes = (d?.parts || [])
      .filter(x => x.release_date)
      .sort((a, b) => a.release_date.localeCompare(b.release_date));
    const primera = partes[0]?.id;
    if (!primera) return;
    for (const c of cols.get(col)) if (c.tmdbId !== primera) fuera.add(c.key);
  });
  return fuera;
}

// Saca lo que no tiene sentido ofrecerle, aunque puntúe alto
export function filtrar(cands, p, prefs = null) {
  const hoy = new Date().toISOString().slice(0, 10);
  return cands.filter(c => {
    const d = c.detalle;
    // Otra de una saga que ya tiene puntuada: o la vio, o la salteó a propósito
    if (d?.coleccion && p.colecciones.has(d.coleccion)) return false;
    if (!c.fecha || c.fecha > hoy) return false;      // todavía no se estrenó

    // Piso de calidad general. Sin esto la lista arrancaba bien y se caía a pique
    // en el puesto 5: cuando quedan pocos candidatos, el relleno es cualquier cosa.
    if ((c.votos || 0) < (prefs?.votosMinimos ?? 30)) return false;
    if (prefs?.notaMinima && (c.nota || 0) < prefs.notaMinima) return false;

    // "Si son anteriores al 2000, en general deberían ser buenas": para lo viejo
    // la nota no descuenta, es una vara. Si no la pasa, ni aparece.
    const anio = d?.anio ?? c.anio;
    if (prefs?.notaMinimaViejas && prefs?.anioMinimo && anio && anio < prefs.anioMinimo) {
      if ((c.nota || 0) < prefs.notaMinimaViejas) return false;
    }
    return true;
  });
}

// Que no se lleven todos los lugares el mismo género ni la misma saga
export function diversificar(lista, n, maxPorGenero = 3, maxPorRincon = 2) {
  const porGenero = new Map(), porRincon = new Map(), colVistas = new Set(), elegidos = [];
  for (const c of lista) {
    if (elegidos.length >= n) break;
    const gens = (c.generos || []).slice(0, 3);
    // Cuenta TODOS sus géneros, no sólo el primero: "Animación/Familia/Aventura"
    // y "Familia/Animación/Aventura" son la misma cosa con el orden cambiado.
    if (gens.some(g => (porGenero.get(g) || 0) >= maxPorGenero)) continue;
    // Y tampoco más de dos que salgan de la MISMA película suya: si no, salían
    // cinco dramas argentinos seguidos, todos colgados de Nueve reinas.
    const rincon = c.masParecidaTuya;
    if (rincon && (porRincon.get(rincon) || 0) >= maxPorRincon) continue;
    const col = c.detalle?.coleccion;
    if (col && colVistas.has(col)) continue;
    for (const g of gens) porGenero.set(g, (porGenero.get(g) || 0) + 1);
    if (rincon) porRincon.set(rincon, (porRincon.get(rincon) || 0) + 1);
    if (col) colVistas.add(col);
    elegidos.push(c);
  }
  for (const c of lista) {                            // si quedó corto, completo
    if (elegidos.length >= n) break;
    if (!elegidos.includes(c)) elegidos.push(c);
  }
  return elegidos;
}

// --- 3. Candidatos: salen de las pelis que le gustaron, no de la nada ---
export async function candidatos(p, { semillas = 24, excluir = new Set(), generos = null, tipo = null, excluirGeneros = null } = {}) {
  // Si pidió un ánimo, las semillas salen de SUS pelis de ese palo. Sin esto,
  // "tensión" arrancaba de Los Simpson y Air Bud y no había con qué arreglarlo:
  // el vecindario Disney/sitcom es mucho más denso en TMDB que el de Chernobyl.
  let base = p.gustadas;
  // Si pidió solo series, sembrar con películas es tirar el presupuesto: los
  // recommendations de una peli devuelven pelis. Siembro del mismo tipo.
  if (tipo) {
    const delTipo = base.filter(s => s.kind === tipo);
    if (delTipo.length >= 3) base = delTipo;
  }
  if (generos?.length) {
    const ids = new Set(generos);
    const delPalo = base.filter(s =>
      (s.features || []).some(f => f.startsWith("gen:") && ids.has(+f.slice(4))));
    if (delPalo.length >= 4) base = delPalo;
  }
  // Y lo que EXCLUYÓ tampoco puede sembrar. Los vecinos de una animada son
  // animadas: sembrar con ellas y tirarlas después es gastar el presupuesto en
  // candidatos que ya sabemos que no van. Es el mismo arreglo que ya tenían el
  // tipo y el género pedido; a la exclusión nunca se lo habían hecho.
  if (excluirGeneros?.length) {
    const veto = new Set(excluirGeneros);
    const limpias = base.filter(s =>
      !(s.features || []).some(f => f.startsWith("gen:") && veto.has(+f.slice(4))));
    if (limpias.length >= 3) base = limpias;
  }
  const seeds = base.slice(0, semillas);
  const mapa = new Map();

  await T.pool(seeds, 6, async (s) => {
    const listas = await Promise.all([
      T.recommendations(s.kind, s.tmdbId),
      T.similar(s.kind, s.tmdbId),
    ]);
    for (const lista of listas) {
      for (const c of (lista?.results || []).slice(0, 20)) {
        const kind = c.media_type || s.kind;
        if (kind !== "movie" && kind !== "tv") continue;
        if (tipo && kind !== tipo) continue;
        const key = kind + ":" + c.id;
        if (excluir.has(key)) continue;             // <-- filtro duro, por id
        const aporte = (s.rating - p.media) / p.desvio;
        const prev = mapa.get(key);
        if (prev) {
          prev.semillas.push({ titulo: s.d.title || s.d.name, aporte });
          prev.apoyo += Math.max(0.2, aporte);
        } else {
          mapa.set(key, {
            key, kind, tmdbId: c.id,
            titulo: c.title || c.name,
            fecha: c.release_date || c.first_air_date || "",
            poster: c.poster_path, resumen: c.overview,
            votos: c.vote_count || 0, nota: c.vote_average || 0,
            apoyo: Math.max(0.2, aporte),
            semillas: [{ titulo: s.d.title || s.d.name, aporte }],
          });
        }
      }
    }
  });
  return [...mapa.values()];
}

// --- 3b. Segunda fuente: buscar en TODO el catálogo, no en los vecinos ---
// `similar`/`recommendations` de TMDB son co-visitas: devuelven la secuela y la
// taquillera del mismo palo. Por eso Chernobyl o Nueve reinas no producían nada.
// Acá salgo a buscar por los directores y las keywords que más pesan en su perfil.
export async function candidatosPorPerfil(p, { excluir = new Set(), generos = null, anioMinimo = null, paginas = 1, tipo = null, excluirGeneros = null, maxMin = null, votosMinimos = null } = {}) {
  const top = (prefijo, n) => [...p.score.entries()]
    .filter(([f, v]) => f.startsWith(prefijo) && v > 0)
    .sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([f]) => +f.slice(prefijo.length));

  const directores = tipo === "tv" ? [] : top("dir:", paginas > 1 ? 12 : 5);
  const keywords = top("kw:", paginas > 1 ? 20 : 12);
  const mapa = new Map();

  const agregar = (lista, kind, origen, etiqueta, peso = 0.6) => {
    for (const c of (lista?.results || []).slice(0, 12)) {
      const key = kind + ":" + c.id;
      if (excluir.has(key) || mapa.has(key)) continue;
      mapa.set(key, {
        key, kind, tmdbId: c.id,
        titulo: c.title || c.name,
        fecha: c.release_date || c.first_air_date || "",
        poster: c.poster_path, resumen: c.overview,
        votos: c.vote_count || 0, nota: c.vote_average || 0,
        apoyo: peso, origen,
        semillas: [{ titulo: etiqueta, aporte: peso }],
      });
    }
  };

  // El piso de votos va A LA FUENTE. Aplicado al final, subirlo no traía películas
  // más conocidas: filtraba las 460 obscuras que ya habían venido y dejaba 2. Acá
  // TMDB devuelve directamente las que lo cumplen, así que subir el piso cambia
  // QUÉ SE BUSCA en vez de solo recortar el resultado.
  const piso = Math.max(150, votosMinimos || 0);
  const comun = { sort_by: "vote_count.desc", "vote_count.gte": piso };
  if (anioMinimo) comun["primary_release_date.gte"] = anioMinimo + "-01-01";
  if (generos?.length) comun.with_genres = generos.join("|");
  // TMDB filtra la exclusión del lado del servidor: así las páginas que vuelven
  // ya vienen sin lo vetado, en vez de traer 20 animadas y quedarnos con cero.
  if (excluirGeneros?.length) comun.without_genres = excluirGeneros.join(",");
  // El tope de duración también va a la fuente: TMDB sabe filtrarlo y así no se
  // gasta el presupuesto trayendo epopeyas de tres horas para descartarlas.
  if (maxMin) comun["with_runtime.lte"] = String(maxMin);

  // Otras que DIRIGIÓ. Ojo: el with_crew de /discover matchea cualquier rol,
  // así que devolvía películas donde el tipo solo figuraba como productor.
  await T.pool(directores, 4, async (id) => {
    const [creditos, quien] = await Promise.all([T.creditosPersona(id), T.persona(id)]);
    const dirigidas = (creditos?.crew || [])
      .filter(c => c.job === "Director")
      .filter(c => (c.vote_count || 0) >= Math.max(120, votosMinimos || 0))
      .filter(c => !anioMinimo || (c.release_date || "") >= anioMinimo + "-01-01")
      .filter(c => !generos?.length || (c.genre_ids || []).some(g => generos.includes(g)))
      .filter(c => !excluirGeneros?.length || !(c.genre_ids || []).some(g => excluirGeneros.includes(g)))
      .sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0));
    agregar({ results: dirigidas }, "movie", "persona", quien?.name || "un director que te gusta");
  });

  // Y por las keywords que más se repiten en lo que puntuás alto
  if (keywords.length) {
    const grupos = [];
    for (let i = 0; i < keywords.length; i += 4) grupos.push(keywords.slice(i, i + 4));
    for (const grupo of grupos) {
      if (!grupo.length) continue;
      // El nombre real de las keywords, para poder decir POR QUÉ y no una vaguedad
      const nombres = grupo.map(id => p.kwNombres?.[id]).filter(Boolean).slice(0, 3);
      const etiqueta = nombres.length ? nombres.join(", ") : null;
      if (tipo !== "tv") {
        for (let pag = 1; pag <= paginas; pag++) {
          const lista = await T.descubrir("movie", { ...comun, with_keywords: grupo.join("|"), page: String(pag) });
          agregar(lista, "movie", "keyword", etiqueta, 0.35);
          if ((lista?.results || []).length < 20) break;
        }
      }

      // Lo mismo para series. Sin esto, las series salían SOLO de los vecinos de
      // Los Simpson y Friends, o sea sitcoms noventosas, y sus mejores semillas
      // (Breaking Bad, Chernobyl, Ataque a los Titanes) no aportaban nada.
      const serieParams = {
        sort_by: "vote_count.desc", "vote_count.gte": Math.max(100, votosMinimos || 0),
        with_keywords: grupo.join("|"),
      };
      if (anioMinimo) serieParams["first_air_date.gte"] = anioMinimo + "-01-01";
      if (generos?.length) serieParams.with_genres = generos.join("|");
      if (excluirGeneros?.length) serieParams.without_genres = excluirGeneros.join(",");
      if (tipo !== "movie") {
        // Si pide series, cavo el doble acá: es la única vía que las trae
        const hondo = tipo === "tv" ? paginas * 2 : paginas;
        for (let pag = 1; pag <= hondo; pag++) {
          const series = await T.descubrir("tv", { ...serieParams, page: String(pag) });
          agregar(series, "tv", "keyword", etiqueta, 0.35);
          if ((series?.results || []).length < 20) break;
        }
      }
    }
  }
  return [...mapa.values()];
}

// --- 3d. "Más como esta": candidatos desde UN título suyo ---
// Su gusto tiene zonas (estafas, misterio, Marvel, infancia) y el promedio de
// todas no es ninguna. Pedir desde una peli concreta es la forma de apuntar.
export async function candidatosDesde(semilla, { excluir = new Set(), paginas = 2 } = {}) {
  const [kind, id] = String(semilla).split(":");
  if (kind !== "movie" && kind !== "tv") return [];
  const d = await T.details(kind, +id);
  if (!d) return [];
  const titulo = d.title || d.name;
  const mapa = new Map();

  const agregar = (lista, k) => {
    for (const c of (lista?.results || [])) {
      const kk = c.media_type || k;
      if (kk !== "movie" && kk !== "tv") continue;
      const key = kk + ":" + c.id;
      if (excluir.has(key) || key === semilla || mapa.has(key)) continue;
      mapa.set(key, {
        key, kind: kk, tmdbId: c.id,
        titulo: c.title || c.name,
        fecha: c.release_date || c.first_air_date || "",
        poster: c.poster_path, resumen: c.overview,
        votos: c.vote_count || 0, nota: c.vote_average || 0,
        apoyo: 1.2, origen: "semilla", semillaTitulo: titulo,
        semillas: [{ titulo, aporte: 1.2 }],
      });
    }
  };

  agregar(await T.recommendations(kind, +id), kind);
  agregar(await T.similar(kind, +id), kind);

  // Y por sus keywords, para salir del vecindario inmediato
  const kws = (d.keywords?.keywords || d.keywords?.results || []).slice(0, 6).map(k => k.id);
  if (kws.length) {
    for (let pag = 1; pag <= paginas; pag++) {
      agregar(await T.descubrir(kind, {
        with_keywords: kws.join(","), sort_by: "vote_count.desc",
        "vote_count.gte": 200, page: String(pag),
      }), kind);
    }
  }
  return [...mapa.values()];
}

// --- 3c. Fuente de fondo: el catálogo por género, paginado ---
// Las dos fuentes de arriba son finitas: los vecinos de sus semillas y sus
// keywords se terminan. Después de ~110 títulos ofrecidos no quedaba nada.
// Esta barre el catálogo por sus géneros preferidos y no se agota.
export async function candidatosAmplios(p, {
  excluir = new Set(), generos = null, anioMinimo = null, desde = 1, paginas = 3, tipo = null,
  excluirGeneros = null, maxMin = null, votosMinimos = null,
} = {}) {
  // Los 6 géneros que más le pesan — pero si excluyó alguno, ese no puede ocupar
  // uno de los 6 lugares. Animación le pesa 2.88 y entraba siempre: con "sin
  // animación" el barrido gastaba un sexto del presupuesto en algo vetado.
  const veto = new Set(excluirGeneros || []);
  const gustados = generos?.length ? generos.filter(g => !veto.has(g))
    : [...p.score.entries()]
        .filter(([f, v]) => f.startsWith("gen:") && v > 0 && !veto.has(+f.slice(4)))
        .sort((a, b) => b[1] - a[1]).slice(0, 6)
        .map(([f]) => +f.slice(4));
  if (!gustados.length) return [];

  const mapa = new Map();
  const pedir = async (kind, params, etiqueta) => {
    for (let pag = desde; pag < desde + paginas; pag++) {
      const lista = await T.descubrir(kind, { ...params, page: String(pag) });
      for (const c of (lista?.results || [])) {
        const key = kind + ":" + c.id;
        if (excluir.has(key) || mapa.has(key)) continue;
        mapa.set(key, {
          key, kind, tmdbId: c.id,
          titulo: c.title || c.name,
          fecha: c.release_date || c.first_air_date || "",
          poster: c.poster_path, resumen: c.overview,
          votos: c.vote_count || 0, nota: c.vote_average || 0,
          apoyo: 0.3, origen: "catalogo",
          semillas: [{ titulo: etiqueta, aporte: 0.3 }],
        });
      }
      if ((lista?.results || []).length < 20) break;
    }
  };

  const base = {
    sort_by: "vote_count.desc",
    "vote_count.gte": Math.max(300, votosMinimos || 0),
    with_genres: gustados.join("|"),
  };
  // La fuente de fondo barre SUS géneros, y Animación es uno de los que más
  // pesa: sin esto el barrido volvía lleno de animadas que después se tiraban.
  if (excluirGeneros?.length) base.without_genres = excluirGeneros.join(",");
  if (maxMin) base["with_runtime.lte"] = String(maxMin);
  if (tipo !== "tv") {
    await pedir("movie", {
      ...base, ...(anioMinimo ? { "primary_release_date.gte": anioMinimo + "-01-01" } : {}),
    }, null);
  }
  if (tipo !== "movie") {
    await pedir("tv", {
      ...base, ...(anioMinimo ? { "first_air_date.gte": anioMinimo + "-01-01" } : {}),
    }, null);
  }
  return [...mapa.values()];
}

// Los géneros que prometen que algo pasa además de gente hablando. Van por id y
// no por nombre: los nombres cambian con el idioma, los ids no. Los de arriba son
// de película y los de abajo de serie (TMDB usa tablas distintas).
const GENEROS_CON_MOVIMIENTO = new Set([
  28,    // Acción
  12,    // Aventura
  878,   // Ciencia ficción
  14,    // Fantasía
  53,    // Suspense
  27,    // Terror
  80,    // Crimen
  9648,  // Misterio
  10752, // Bélica
  37,    // Western
  10759, // Action & Adventure (serie)
  10765, // Sci-Fi & Fantasy (serie)
  10768, // War & Politics (serie)
]);

// Estos no son "movimiento", pero tampoco son de lo que él se queja: una comedia
// no es un drama hablado. Y animación y familia ya tienen sus propias reglas más
// abajo — sin esto pagaban dos veces, y un anime como Komi-san salía marcado
// "puro diálogo, sin acción", que es cualquier cosa.
// Medido sobre sus 284: sin esta salvedad la regla tocaba 40 títulos y se llevaba
// puestos 17 que él puntuó 8+ (Friends, Los Simpson, Mi pobre angelito) contra 12
// flojos. Con la salvedad toca 17 y queda 6 contra 6 — y los 6 flojos son
// exactamente los que él nombra (El gran Gatsby 2, Los Fabelman 2, Oppenheimer 5).
const GENEROS_QUE_NO_SON_DRAMA_HABLADO = new Set([
  35,    // Comedia
  16,    // Animación
  10751, // Familia
]);

// --- 4. Preferencias declaradas ---
// Son las que las puntuaciones NO enseñan solas: que la serie esté terminada,
// que no sea eterna, que no sea vieja. Devuelve el ajuste y por qué.
export function preferencias(c, prefs, p_perfiles = null) {
  if (!prefs) return { ajuste: 0, notas: [] };
  let ajuste = 0;
  const notas = [];
  const d = c.detalle || c;

  // Nada de estructuras repetitivas: Memento (1) y el día de la marmota
  if (prefs.evitarKeywords?.length && d.kwNames?.length) {
    const choca = prefs.evitarKeywords.find(k => d.kwNames.some(n => n.includes(k.toLowerCase())));
    if (choca) { ajuste -= prefs.penalizacionEvitar ?? 1.5; notas.push("estructura tipo «" + choca + "»"); }
  }

  // Antes de 2000 solo si es muy buena
  if (prefs.anioMinimo && d.anio && d.anio < prefs.anioMinimo) {
    const indulto = (c.nota || 0) >= (prefs.excepcionPreAnioSiNota ?? 99);
    ajuste -= (prefs.penalizacionPreAnio ?? 0.9) * (indulto ? 0.3 : 1);
    if (!indulto) notas.push("es de " + d.anio);
  }

  // Ciencia ficción y fantasía viejas: los efectos son lo que peor envejece, y
  // él lo dijo tres veces ("efectos especiales viejos"). Castigo aparte del de
  // época, porque un drama del 95 envejece bien y un sci-fi del 95 no.
  if (prefs.penalizarEfectosViejos && prefs.anioMinimo && d.anio && d.anio < prefs.anioMinimo) {
    const g = new Set((c.generos || d.generos || []).map(x => x.toLowerCase()));
    if (g.has("ciencia ficción") || g.has("fantasía") || g.has("sci-fi & fantasy")) {
      ajuste -= prefs.penalizarEfectosViejos;
      notas.push("efectos de la época");
    }
  }

  if (c.kind === "tv") {
    // Serie terminada
    const abierta = d.status && !/ended|canceled|cancelled/i.test(d.status);
    if (prefs.seriesTerminadas && abierta) {
      ajuste -= prefs.penalizacionSerieAbierta ?? 0.8;
      notas.push("todavía no terminó");
    }
    // Que no sea eterna
    const max = prefs.maxEpisodios ?? 60;
    if (d.episodios && d.episodios > max) {
      ajuste -= (prefs.penalizacionEpisodios ?? 0.8) * Math.min(1, (d.episodios - max) / max);
      notas.push(d.episodios + " capítulos");
    }
    // Capítulos cortos: se banca mejor lo que no lo termina de convencer (Barry)
    if (prefs.bonusCapituloCorto && d.dur && d.dur <= 35) ajuste += prefs.bonusCapituloCorto;
  }

  // Se parece a las que él marcó con alguno de sus motivos
  if (prefs.penalizarMotivos && p_perfiles?.size) {
    for (const [mot, perfil] of p_perfiles) {
      let coincide = 0;
      for (const f of (d.features || [])) if (perfil.has(f)) coincide += perfil.get(f);
      if (coincide > 0.9) {
        ajuste -= prefs.penalizarMotivos * Math.min(1, coincide);
        notas.push("se parece a las que marcaste «" + mot + "»");
      }
    }
  }

  // Género "Familia" en imagen real: es el mismo cluster de infancia que la
  // animación de Disney, pero la regla de animación no lo toca. Sus 12 películas
  // familiares en vivo promedian 7.75 contra 6.89 del resto — están altas por lo
  // mismo (Mi pobre angelito, Jumanji, El libro de la selva).
  if (prefs.penalizarFamilia) {
    const g = new Set((c.generos || d.generos || []).map(x => x.toLowerCase()));
    if (g.has("familia") && !g.has("animación")) {
      ajuste -= prefs.penalizarFamilia;
      notas.push("película familiar");
    }
  }

  // "Si es 100% hablada, sin un poquito de acción o alguna cosita más, es difícil
  // que me guste." Es lo que él pidió, y no lo enseñan sus notas: medido sobre sus
  // 284, tener o no un género de movimiento correlaciona -0.001 con el puntaje que
  // pone (70% de gusto de los dos lados). Así que va como REGLA declarada, no como
  // hallazgo: se prende, se apaga y se gradúa desde Mis gustos.
  // Crimen y Misterio cuentan como movimiento a propósito: ahí viven las estafas y
  // los giros (Nueve reinas, El secreto de sus ojos), que son de lo que más puntúa.
  if (prefs.penalizarSoloHablada) {
    const ids = c.generosIds || d.generosIds || [];
    const puroDialogo = ids.length
      && !ids.some(g => GENEROS_CON_MOVIMIENTO.has(g))
      && !ids.some(g => GENEROS_QUE_NO_SON_DRAMA_HABLADO.has(g));
    if (puroDialogo) {
      ajuste -= prefs.penalizarSoloHablada;
      notas.push("puro diálogo, sin acción");
    }
  }

  // Animación NO japonesa. Sus dieces de animación son de la infancia (Toy Story,
  // Air Bud) y arrastraban todo el catálogo Disney; hoy no quiere animadas salvo
  // anime. El anime queda exento a propósito: ese sí lo mira ahora.
  const gen = new Set((c.generos || d.generos || []).map(x => x.toLowerCase()));
  const esJapones = (d.features || []).includes("lang:ja");
  if (gen.has("animación") && !esJapones) {
    const infantil = gen.has("familia");
    const castigo = infantil
      ? (prefs.penalizarInfantil ?? 0)
      : (prefs.penalizarAnimacionOccidental ?? 0);
    if (castigo) {
      ajuste -= castigo;
      notas.push(infantil ? "animación infantil" : "animación no japonesa");
    }
  }
  return { ajuste, notas };
}

// --- 5. Puntaje final ---
// Parecido directo entre dos títulos (Jaccard sobre sus rasgos). Es lo que hay
// que medir cuando pide "más como esta": contra ESA, no contra su promedio, que
// está dominado por Marvel y Harry Potter y le da cero al policial argentino.
export function parecidoA(featuresSemilla, features) {
  if (!featuresSemilla?.length || !features?.length) return 0;
  const a = new Set(featuresSemilla), b = new Set(features);
  let inter = 0;
  for (const f of a) if (b.has(f)) inter++;
  return inter / (a.size + b.size - inter);
}

// Traduce el puntaje crudo del modelo a "de cada 10 así, cuántas te gustaron".
// Sin esto le mostraba 0.44 y lo leía como "44% de posibilidades", cuando en
// realidad a ese nivel el 94% se lo llevó con 7 o más.

// Pool adjacent violators: fuerza que a más puntaje no baje la probabilidad,
// promediando los bloques que se contradicen. Se usa dos veces — antes y
// después de fusionar los flacos — porque fusionar puede volver a romper el
// orden.
function isotonica(bloques) {
  for (let i = 1; i < bloques.length; i++) {
    while (i > 0 && bloques[i - 1].suma / bloques[i - 1].n > bloques[i].suma / bloques[i].n) {
      bloques[i - 1].suma += bloques[i].suma;
      bloques[i - 1].n += bloques[i].n;
      bloques.splice(i, 1);
      i--;
    }
  }
  return bloques;
}

export function calibrar(todas, muestra = Infinity, { minBloque = 20, prior = 8 } = {}) {
  // Las que él sacó del perfil tampoco calibran: si no representan su gusto, no
  // pueden decidir qué significa un 78%.
  const vistas = todas.filter(v => !noCuenta(v));
  if (vistas.length < 30) return null;
  // Todas sus puntuaciones, no una de cada tres. Muestrear 90 de 284 tiraba dos
  // tercios de la evidencia justo donde más falta hace: arriba, donde cada
  // bloque terminaba con una sola película adentro.
  const paso = Math.max(1, Math.floor(vistas.length / muestra));
  const puntos = [];
  for (let i = 0; i < vistas.length; i += paso) {
    const p = perfil(vistas.filter((_, j) => j !== i));
    puntos.push({ pred: afinidad(p, vistas[i].features), gusto: vistas[i].rating >= 7 });
  }
  puntos.sort((a, b) => a.pred - b.pred);
  // Probabilidad LOCAL: de las que puntuaron parecido a este nivel, cuántas le
  // gustaron. La acumulada ("de acá para arriba") daba 89-96% para todo y no
  // servía para elegir entre dos opciones.
  let bloques = isotonica(puntos.map(p => ({ suma: p.gusto ? 1 : 0, n: 1, corte: p.pred })));

  // Un porcentaje sostenido por UNA película no es un porcentaje. La isotónica
  // sobre datos binarios siempre termina en bloques puros: los 20 tramos de
  // arriba tenían n=1 cada uno y publicaban "100%" (la tarjeta lo mostraba
  // como 96%) porque esa única película le había gustado. Cada bloque tiene que
  // llegar a minBloque observaciones o fusionarse con el vecino más flaco.
  let cambio = true;
  while (cambio && bloques.length > 1) {
    cambio = false;
    for (let i = 0; i < bloques.length; i++) {
      if (bloques[i].n >= minBloque) continue;
      const j = i === 0 ? 1
        : i === bloques.length - 1 ? i - 1
        : (bloques[i - 1].n <= bloques[i + 1].n ? i - 1 : i + 1);
      const [a, b] = i < j ? [i, j] : [j, i];
      bloques[a].suma += bloques[b].suma;
      bloques[a].n += bloques[b].n;
      bloques[a].corte = Math.min(bloques[a].corte, bloques[b].corte);
      bloques.splice(b, 1);
      cambio = true;
      break;
    }
  }
  bloques = isotonica(bloques);

  // Y encima se encoge hacia su tasa base (cuánto le gusta lo que ve en
  // general). Con prior=8, un bloque chico y optimista se acerca al promedio en
  // vez de prometer el 100%; uno grande casi no se mueve.
  const base = puntos.filter(p => p.gusto).length / puntos.length;
  return bloques.map(b => ({
    corte: b.corte,
    prob: (b.suma + prior * base) / (b.n + prior),
    n: b.n,
  }));
}

// Dado un puntaje, qué proporción de lo que puntúa parecido le gustó
export function probabilidad(curva, valor) {
  if (!curva?.length) return null;
  if (valor <= curva[0].corte) return curva[0].prob;
  let mejor = curva[0].prob;
  for (const c of curva) {
    if (c.corte > valor) break;
    mejor = c.prob;
  }
  return mejor;
}

// La afinidad tal como la usa el motor. La usa también backtest.mjs, para que
// lo que se mide sea exactamente lo que corre.
export function afinidad(p, features) {
  if (!features?.length) return 0;
  let rasgos = 0;
  for (const x of features) rasgos += p.score.get(x) || 0;
  rasgos = rasgos / Math.sqrt(features.length);
  return 0.5 * afinidadVecinos(p, features) + 0.5 * (rasgos / 3);
}

export function puntuar(cands, p, { prefs = null } = {}) {
  const maxApoyo = Math.max(...cands.map(c => c.apoyo), 1);
  for (const c of cands) {
    const f = c.detalle ? c.detalle.features : [];

    // Afinidad: mitad rasgos sueltos, mitad "a cuáles de las suyas se parece".
    // La mezcla la elegí midiendo con backtest.mjs, no a ojo.
    const afin = afinidad(p, f);
    c.masParecidaTuya = afinidadVecinos(p, f, 20, true);

    // Acuerdo entre semillas: si salió de 4 pelis distintas que le gustaron, vale más
    const apoyo = c.apoyo / maxApoyo;
    const acuerdo = Math.min(c.semillas.length / 4, 1);

    // Calibrado de popularidad, PERO DE UN SOLO LADO. Antes era una campana
    // centrada en su promedio (9.664 votos), así que castigaba tanto lo desconocido
    // como lo MUY visto: una de 200.000 votos sacaba 0.56 y una de un millón, 0.33.
    // El motor terminaba apuntando a un nicho de ~10.000 votos y el 82% de lo que
    // ofrecía tenía menos de 10.000. Medido sobre sus 285, eso está al revés: la
    // correlación popularidad/nota es +0.133, y a las de más de 10.000 votos les
    // pone 7.29 contra 6.92 a las de menos. Ser más conocida no puede restar.
    const votos = Math.log10(1 + c.votos);
    const obscuridad = votos >= p.votosMedios
      ? 1
      : 1 - Math.min((p.votosMedios - votos) / 3, 1);

    const dur = c.detalle?.dur;
    const duracion = dur ? 1 - Math.min(Math.abs(dur - p.durMedia) / 90, 1) : 0.5;

    const calidad = (c.nota || 0) / 10;
    const conVotos = c.votos > 60 ? 1 : c.votos / 60;   // cosas sin votos son ruido

    const pref = preferencias(c, prefs, p.perfilesMotivo);
    c.avisos = pref.notas;
    // La confianza tiene que incluir sus reglas declaradas, no solo la afinidad
    // de gusto. Si no, ordenar por confianza ignoraba "nada de animación", "nada
    // viejo" y las marcas de motivo: se avisaba pero no bajaba a nadie.
    c.confianza = afin + 0.5 * pref.ajuste;
    c.partes = { afin, apoyo, acuerdo, obscuridad, duracion, calidad, prefs: pref.ajuste };
    c.score = (
      1.7 * apoyo +
      1.3 * acuerdo +
      2.2 * afin +
      0.5 * obscuridad +
      0.3 * duracion +
      0.35 * calidad
    ) * (0.35 + 0.65 * conVotos) + (c.boostAnimo || 0) + pref.ajuste;
  }
  return cands.sort((a, b) => b.score - a.score);
}

// Por qué se la recomienda: en castellano, con las pelis suyas que la trajeron
const enumerar = (xs) =>
  xs.length <= 1 ? (xs[0] || "") : xs.slice(0, -1).join(", ") + " y " + xs[xs.length - 1];

export function motivo(c, p) {
  const top = [...c.semillas].sort((a, b) => b.aporte - a.aporte).slice(0, 2).map(s => s.titulo);
  if (c.origen === "semilla") return "Del palo de " + (c.semillaTitulo || top[0]) + ", que puntuaste alto.";
  if (c.origen === "catalogo") return "No salió de ninguna tuya en particular: es de los géneros que más puntuás alto.";
  if (c.origen === "persona") return `Otra de ${top[0]}, que aparece varias veces entre tus mejores puntajes.`;

  if (c.origen === "keyword") {
    // Nombro las keywords que ESTA película tiene y que además pesan en su perfil.
    // Antes volcaba el grupo que disparó la búsqueda y decía «pixar» para Naruto.
    const suyas = (c.detalle?.features || [])
      .filter(f => f.startsWith("kw:"))
      .map(f => +f.slice(3))
      .filter(id => (p?.score.get("kw:" + id) || 0) > 0)
      .sort((a, b) => p.score.get("kw:" + b) - p.score.get("kw:" + a))
      .slice(0, 3)
      .map(id => p?.kwNombres?.[id])
      .filter(Boolean);
    if (!suyas.length) return "Cruza varias señales de tu perfil a la vez.";
    return `Tiene ${enumerar(suyas.map(x => "«" + x + "»"))}, que aparecen seguido en lo que puntuás alto.`;
  }

  if (c.semillas.length >= 3) return `Salió de ${c.semillas.length} que puntuaste alto, entre ellas ${enumerar(top)}.`;
  return `Porque te gustó ${enumerar(top)}.`;
}
