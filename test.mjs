// Prueba de parsers + motor con datos sintéticos (sin red, sin API key).
import fs from "node:fs";
import { PREFS_POR_DEFECTO } from "./datos.mjs";
import { parseImdbCSV, parseNotepad, mergeRatings, parseAgrupado, variantesBusqueda } from "./ratings.mjs";
import * as M from "./motor.mjs";
import * as V from "./vecinas.mjs";

let fallos = 0;
const ok = (cond, msg) => { console.log((cond ? "  ok  " : "FALLA ") + msg); if (!cond) fallos++; };

console.log("\n--- 1. Bloc de notas (formatos varios) ---");
const notas = `
El Padrino 9
Whiplash - 8
Interestelar (2014): 7,5
9 - Los Sospechosos de Siempre
Perdidos en Tokio ....... 6
The Wire 10/10
Mad Men (2007) 8
--------
una linea sin nota
Blade Runner 2049 8
`;
const n = parseNotepad(notas);
console.log(n.map(r => `${r.rating.toString().padStart(4)}  ${r.title}${r.year ? " (" + r.year + ")" : ""}`).join("\n"));
ok(n.length === 8, `parseó 8 líneas (dio ${n.length})`);
ok(n.find(r => r.title === "El Padrino")?.rating === 9, "puntaje al final");
ok(n.find(r => r.title === "Whiplash")?.rating === 8, "con guión");
ok(n.find(r => r.title === "Interestelar")?.year === 2014, "año entre paréntesis");
ok(n.find(r => r.title === "Interestelar")?.rating === 7.5, "decimal con coma");
ok(n.find(r => r.title === "Los Sospechosos de Siempre")?.rating === 9, "puntaje al principio");
ok(n.find(r => r.title === "The Wire")?.rating === 10, "formato /10");
ok(n.find(r => r.title === "Perdidos en Tokio")?.rating === 6, "separado por puntos");
ok(!n.find(r => r.title.includes("sin nota")), "descarta la línea sin puntaje");
ok(n.find(r => r.title === "Blade Runner 2049")?.rating === 8, "no se come el número del título");

console.log("\n--- 2. Export de IMDb ---");
const csv = `Const,Your Rating,Date Rated,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors
tt0068646,9,2024-01-05,The Godfather,The Godfather,https://www.imdb.com/title/tt0068646/,Movie,9.2,175,1972,"Crime, Drama",2000000,1972-03-14,Francis Ford Coppola
tt0903747,10,2024-02-11,"Breaking Bad, la serie",Breaking Bad,https://www.imdb.com/title/tt0903747/,TV Series,9.5,49,2008,"Crime, Drama, Thriller",2100000,2008-01-20,
tt0111161,8,2023-11-30,The Shawshank Redemption,The Shawshank Redemption,https://www.imdb.com/title/tt0111161/,Movie,9.3,142,1994,Drama,2800000,1994-09-23,Frank Darabont
tt9999999,7,2024-03-01,Un episodio suelto,Un episodio suelto,https://www.imdb.com/title/tt9999999/,TV Episode,7.1,42,2015,Drama,100,2015-01-01,Alguien`;
const c = parseImdbCSV(csv);
console.log(c.map(r => `${r.rating.toString().padStart(4)}  ${r.kind.padEnd(5)}  ${r.imdb}  ${r.title}`).join("\n"));
ok(c.length === 3, `3 filas, sin el episodio suelto (dio ${c.length})`);
ok(c[0].imdb === "tt0068646" && c[0].kind === "movie", "película con su tt id");
ok(c[1].kind === "tv", "TV Series -> tv");
ok(c[1].title === "Breaking Bad, la serie", "campo con coma entre comillas");
ok(!c.find(r => r.title === "Un episodio suelto"), "descarta TV Episode");

console.log("\n--- 3. Merge sin duplicados ---");
const merged = mergeRatings([c, parseNotepad("The Godfather 9\nOtra Peli 7")]);
ok(merged.filter(r => r.title.toLowerCase().includes("godfather")).length === 1, "no duplica The Godfather");
ok(merged.length === 4, `3 del CSV + 1 nueva del bloc (dio ${merged.length})`);

console.log("\n--- 4. Perfil de gusto ---");
// Sintético: le gustan los thrillers de Fincher, odia las comedias románticas
const F = (gen, extra = []) => [...gen.map(g => "gen:" + g), ...extra];
const vistas = [
  { key: "m:1", rating: 9, features: F([53, 80], ["dir:7467", "kw:1", "kw:2"]), votos: 900000, dur: 139, anio: 1999 },
  { key: "m:2", rating: 9, features: F([53, 80], ["dir:7467", "kw:1", "kw:3"]), votos: 700000, dur: 158, anio: 2007 },
  { key: "m:3", rating: 8, features: F([53, 18], ["kw:1", "kw:4"]), votos: 400000, dur: 130, anio: 2014 },
  { key: "m:4", rating: 3, features: F([35, 10749], ["kw:9", "kw:8"]), votos: 200000, dur: 95, anio: 2011 },
  { key: "m:5", rating: 4, features: F([35, 10749], ["kw:9"]), votos: 300000, dur: 101, anio: 2009 },
  { key: "m:6", rating: 6, features: F([28], ["kw:7"]), votos: 500000, dur: 120, anio: 2016 },
];
const p = M.perfil(vistas);
console.log("  media:", p.media.toFixed(2), " gustadas:", p.gustadas.length, " dur media:", Math.round(p.durMedia));
ok(p.score.get("gen:53") > 0, "thriller puntúa positivo");
ok(p.score.get("gen:10749") < 0, "romance puntúa negativo (aprende de lo que odió)");
ok(p.score.get("dir:7467") > p.score.get("gen:18"), "el director que le gusta pesa más que un género genérico");
ok(p.gustadas.length === 3, `3 títulos por encima de su media (dio ${p.gustadas.length})`);

console.log("\n--- 5. Scoring: ordena bien ---");
const cands = [
  { key: "m:10", titulo: "Thriller de Fincher", votos: 600000, nota: 8.1, apoyo: 2.0,
    semillas: [{ titulo: "A", aporte: 1.2 }, { titulo: "B", aporte: 1.1 }, { titulo: "C", aporte: 0.9 }],
    detalle: { dur: 145, features: F([53, 80], ["dir:7467", "kw:1"]) } },
  { key: "m:11", titulo: "Comedia romántica", votos: 250000, nota: 6.9, apoyo: 0.3,
    semillas: [{ titulo: "D", aporte: 0.3 }],
    detalle: { dur: 98, features: F([35, 10749], ["kw:9"]) } },
  { key: "m:12", titulo: "Thriller flojo sin votos", votos: 12, nota: 9.4, apoyo: 0.4,
    semillas: [{ titulo: "E", aporte: 0.4 }],
    detalle: { dur: 140, features: F([53], ["kw:1"]) } },
];
const ord = M.puntuar(cands, p);
console.log(ord.map(c => `  ${c.score.toFixed(2)}  ${c.titulo}`).join("\n"));
ok(ord[0].titulo === "Thriller de Fincher", "gana el que cruza director + género + varias semillas");
ok(ord[ord.length - 1].titulo !== "Thriller de Fincher", "la comedia romántica no gana");
ok(ord.find(c => c.titulo === "Thriller flojo sin votos").score < ord[0].score, "nota alta con 12 votos no engaña al ranking");

console.log("\n--- 6. Motivo en castellano ---");
console.log("  " + M.motivo(cands.find(c => c.titulo === "Thriller de Fincher")));
console.log("  " + M.motivo(cands.find(c => c.titulo === "Comedia romántica")));
ok(M.motivo(cands[0]).includes("Salió de") || M.motivo(cands[0]).includes("Porque te gustó"), "motivo legible");


console.log("\n--- 7. Formato agrupado (el suyo) ---");
const agr = parseAgrupado(`10 Puntos: El padrino, Attack on Titan (Shingeki no kyojin), X-Men (2000)
9 Puntos: Shrek 2, One Piece
1 Punto: Amnesia (Memento)`);
console.log(agr.map(r => `  ${r.rating}  ${r.title}${r.year ? " [" + r.year + "]" : ""}`).join("\n"));
ok(agr.length === 6, `6 títulos de 3 líneas (dio ${agr.length})`);
ok(agr.find(r => r.title === "El padrino")?.rating === 10, "toma el puntaje del grupo");
ok(agr.find(r => r.title === "X-Men")?.year === 2000, "año entre paréntesis al final");
ok(agr.find(r => r.title === "Attack on Titan (Shingeki no kyojin)"), "no confunde título alternativo con año");
ok(agr.find(r => r.title === "Amnesia (Memento)")?.rating === 1, "'1 Punto' en singular");

console.log("\n--- 8. Variantes de búsqueda ---");
const v1 = variantesBusqueda("El origen (Inception)");
ok(v1[0] === "Inception", "prueba primero el título original entre paréntesis");
const v2 = variantesBusqueda("Harry Potter y las reliquias de la muerte (parte 2)");
ok(!v2.includes("parte 2"), "no busca '(parte 2)' como si fuera un título");
ok(variantesBusqueda("Harry Potter 3").includes("Harry Potter"), "cae al nombre sin el numeral");

console.log("\n--- 9. Preferencias declaradas ---");
console.log("");
console.log("--- 8b. La curva no puede comerse el tope ---");
// Agrupaba DESPUÉS de la isotónica —bloques de a uno y después fusionar los
// flacos— y esa fusión se tragaba la punta: medido sobre sus 259 puntuaciones, el
// bloque de arriba arrancaba en 0.55 con 54 títulos adentro, así que la primera
// pantalla entera mostraba el mismo número. Y era falso: arriba de 0.92 sus notas
// dan 8.2 y 78% de 8+, contra 7.5 y 57% abajo.
{
  // 120 títulos: los 30 de arriba son sus dieces, el resto un seis.
  const n = 120;
  const falsas = Array.from({ length: n }, (_, i) => ({ rating: i >= 90 ? 10 : 6 }));
  const preds = Array.from({ length: n }, (_, i) => -1 + (2 * i) / (n - 1));
  const curva = M.calibrarNota(falsas, { preds, minBloque: 30 });
  const arriba = curva[curva.length - 1];
  console.log("  curva:", curva.map(b => b.corte.toFixed(2) + "->" + b.nota.toFixed(1) + "(n" + b.n + ")").join(" "));
  ok(curva.length >= 2, "la curva distingue tramos en vez de devolver uno solo");
  ok(arriba.n <= 40, `el bloque de arriba no se come media muestra (n=${arriba.n})`);
  ok(arriba.nota > curva[0].nota + 2, "y el tramo de arriba vale mucho más que el de abajo");
  ok(M.notaEsperada(curva, 0.9) > M.notaEsperada(curva, -0.9), "leerla de vuelta respeta el orden");
  const c8 = M.calibrar(falsas, Infinity, { preds, umbral: 8, minBloque: 30 });
  ok(M.probabilidad(c8, 0.9) > 0.6 && M.probabilidad(c8, -0.9) < 0.25,
     "la de 8+ también separa el tope del fondo");
}

// Las reglas prendidas, escritas acá y no leídas del default. El default pasó a
// ser neutro —nadie hereda las manías de otro—, así que un test que lo usara para
// probar que la regla funciona estaría probando que la regla está apagada. Los
// valores son los que traía antes: alguien que contestó que sí a todo en Mis gustos.
const PREFS_CON_TODO = {
  ...PREFS_POR_DEFECTO,
  notaMinimaViejas: 8.0, penalizacionPreAnio: 0.9, penalizarEfectosViejos: 1.2,
  seriesTerminadas: true, penalizacionSerieAbierta: 0.8, penalizacionEpisodios: 0.8,
  bonusCapituloCorto: 0.25, episodiosSoloMuyBuenas: 100,
  penalizarInfantil: 2.2, penalizarAnimacionOccidental: 1.6, penalizarFamilia: 1.4,
  idiomasSoloMuyBuenas: ["ko", "zh", "cn", "ja"], aniosSciFiVieja: 15,
  penalizarMusical: 1,
  evitarKeywords: ["time loop", "nonlinear timeline", "amnesia", "memory loss"],
};
const prefs = PREFS_CON_TODO;
const P = (extra) => M.preferencias(extra, prefs);

const vieja = P({ kind: "movie", nota: 7.0, detalle: { anio: 1995, kwNames: [] } });
console.log("  peli del 95, nota 7.0 ->", vieja.ajuste.toFixed(2), JSON.stringify(vieja.notas));
ok(vieja.ajuste < 0, "peli anterior a 2000 pierde puntos");

const viejaBuena = P({ kind: "movie", nota: 8.6, detalle: { anio: 1972, kwNames: [] } });
console.log("  peli del 72, nota 8.6 ->", viejaBuena.ajuste.toFixed(2), JSON.stringify(viejaBuena.notas));
ok(viejaBuena.ajuste > vieja.ajuste, "si es de las muy buenas, la penalización de época casi no pega");

// El indulto de las viejas ahora pide EVIDENCIA, no la nota de TMDB. Harakiri
// (1962, TMDB 8.5) salía segunda de la lista con 286 puntuaciones de las que solo
// dos son anteriores a 1980. Con años cerca, el indulto sigue valiendo.
const conEpoca = Array.from({ length: 8 }, (_, i) => 1958 + i);      // ocho de los 60
const sinEpoca = Array.from({ length: 40 }, (_, i) => 2000 + (i % 20));
const viejaConocida = M.preferencias({ kind: "movie", nota: 8.6, detalle: { anio: 1962, kwNames: [] } }, prefs, null, conEpoca);
const viejaDesconocida = M.preferencias({ kind: "movie", nota: 8.6, detalle: { anio: 1962, kwNames: [] } }, prefs, null, sinEpoca);
console.log("  del 62 con época conocida ->", viejaConocida.ajuste.toFixed(2),
            "| sin época ->", viejaDesconocida.ajuste.toFixed(2));
ok(viejaDesconocida.ajuste < viejaConocida.ajuste,
   "una del 62 muy bien puntuada paga la época entera si de esos años no puntuaste nada");
ok(viejaDesconocida.notas.some(n => n.includes("casi no puntuaste")),
   "y la tarjeta lo dice, en vez de bajarla en silencio");
ok(!viejaConocida.notas.length, "con puntuadas de esa época, el indulto sigue valiendo");

const loop = P({ kind: "movie", nota: 8.0, detalle: { anio: 2014, kwNames: ["time loop", "sci-fi"] } });
console.log("  con keyword 'time loop' ->", loop.ajuste.toFixed(2), JSON.stringify(loop.notas));
ok(loop.ajuste <= -1.4, "las estructuras que se repiten pagan caro (Memento = 1)");

const abierta = P({ kind: "tv", nota: 8.0, detalle: { anio: 2022, kwNames: [], status: "Returning Series", episodios: 20 } });
console.log("  serie en emisión ->", abierta.ajuste.toFixed(2), JSON.stringify(abierta.notas));
ok(abierta.ajuste < 0 && abierta.notas.some(n => n.includes("terminó")), "serie que sigue al aire pierde puntos");

const terminada = P({ kind: "tv", nota: 8.0, detalle: { anio: 2022, kwNames: [], status: "Ended", episodios: 20, dur: 50 } });
console.log("  serie terminada, 20 cap. ->", terminada.ajuste.toFixed(2), JSON.stringify(terminada.notas));
ok(terminada.ajuste === 0, "serie terminada y corta no paga nada");

const eterna = P({ kind: "tv", nota: 8.0, detalle: { anio: 2010, kwNames: [], status: "Ended", episodios: 300, dur: 45 } });
console.log("  serie de 300 cap. ->", eterna.ajuste.toFixed(2), JSON.stringify(eterna.notas));
ok(eterna.ajuste < -0.5, "300 capítulos pierde bastante");
ok(eterna.ajuste > -3, "pero no la borra del mapa: One Piece le gustó igual");

const corta = P({ kind: "tv", nota: 7.5, detalle: { anio: 2018, kwNames: [], status: "Ended", episodios: 24, dur: 30 } });
console.log("  serie de 30 min ->", corta.ajuste.toFixed(2));
ok(corta.ajuste > 0, "capítulos cortos suman (lo dijo por Barry)");

const musical = P({ kind: "tv", nota: 7.6, detalle: { anio: 2008, kwNames: ["musical", "parody"], status: "Ended", episodios: 3, dur: 45 } });
console.log("  un musical ->", musical.ajuste.toFixed(2), JSON.stringify(musical.notas));
ok(musical.ajuste < 0 && musical.notas.includes("musical"), "un musical baja (Dr. Horrible)");
ok(musical.ajuste > -1.5, "pero menos que lo de Evitar: dijo «habría que ver»");
const teatro = P({ kind: "tv", nota: 8.0, detalle: { anio: 2016, kwNames: ["based on play or musical"], status: "Ended", episodios: 12, dur: 45 } });
ok(!teatro.notas.includes("musical"), "«based on play or musical» no es un musical (Fleabag)");

console.log("\n--- 10. Las reglas mueven el ranking de verdad ---");
const dos = [
  { key: "tv:1", titulo: "Serie nueva en emisión", kind: "tv", votos: 90000, nota: 8.2, apoyo: 1.5,
    semillas: [{ titulo: "Breaking Bad", aporte: 1.4 }, { titulo: "Chernobyl", aporte: 1.0 }],
    detalle: { anio: 2024, kwNames: [], status: "Returning Series", episodios: 16, dur: 55, features: F([18], ["kw:1"]) } },
  { key: "tv:2", titulo: "Serie terminada y corta", kind: "tv", votos: 90000, nota: 8.2, apoyo: 1.5,
    semillas: [{ titulo: "Breaking Bad", aporte: 1.4 }, { titulo: "Chernobyl", aporte: 1.0 }],
    detalle: { anio: 2024, kwNames: [], status: "Ended", episodios: 16, dur: 30, features: F([18], ["kw:1"]) } },
];
const rank = M.puntuar(dos, p, { prefs });
console.log(rank.map(c => `  ${c.score.toFixed(2)}  ${c.titulo}  ${JSON.stringify(c.avisos)}`).join("\n"));
ok(rank[0].titulo === "Serie terminada y corta", "a igualdad de todo lo demás, gana la terminada");

console.log("\n--- 11. Series: la vara de votos y los géneros en el idioma de cada tipo ---");
// Con votosMinimos 5000 pasaban 1061 películas y 69 series: "Serie" salía vacío.
ok(M.pisoVotos(5000, "movie") === 5000, "a las películas la vara no les cambia");
ok(M.pisoVotos(5000, "tv") === 547, `5000 votos de película = 547 de serie (dio ${M.pisoVotos(5000, "tv")})`);
ok(M.pisoVotos(150, "tv") === 11, `150 de película = 11 de serie (dio ${M.pisoVotos(150, "tv")})`);
const escalera = [30, 150, 800, 3000, 5000, 7000, 10000, 20000].map(v => M.pisoVotos(v, "tv"));
ok(escalera.every((v, i) => i === 0 || v > escalera[i - 1]), "más vara de pelis, más vara de series: " + escalera.join(" < "));
const serieConocida = { key: "tv:9", kind: "tv", fecha: "2019-01-01", votos: 2000, nota: 8.1, detalle: { anio: 2019 } };
const peliIgual = { ...serieConocida, key: "movie:9", kind: "movie" };
const pasan = M.filtrar([serieConocida, peliIgual], { colecciones: new Set() }, { votosMinimos: 5000, notaMinima: 6.4 });
ok(pasan.length === 1 && pasan[0].kind === "tv", "con vara 5000, una serie de 2000 votos pasa y una peli de 2000 no");

// Lo que aprendió de sus películas de acción tiene que valer para una serie de acción
const accion = M.rasgos({ genres: [{ id: 10759, name: "Action & Adventure" }], first_air_date: "2015-01-01" }, "tv");
ok(accion.features.includes("gen:28") && accion.features.includes("gen:12"), "Action & Adventure cuenta como Acción y Aventura");
ok(accion.generosIds.includes(10759), "los ids crudos quedan: son los que usan los chips");
ok(M.generosPara("tv", [28, 53]).join() === "10759", "a /discover/tv se le pide Acción con su id de TV, y Suspenso (que ahí no existe) no va");
ok(M.generosPara("tv", [12], { excluyendo: true }).length === 0, "vetar Aventura no veta toda la acción de las series");
ok(M.generosPara("movie", [28, 10759]).join() === "28,10759", "a las películas no se les toca nada");

console.log("\n--- 12. Calibrar rápido da lo mismo que rearmar el perfil ---");
// calibrar() armaba un perfil entero por título; ahora resta la parte de cada
// uno. Tiene que dar lo mismo, con rasgos repetidos y títulos sin nota. Lo
// etiquetado no llega hasta acá: prepararMezcla() ya lo filtró.
let azar = 7;
const dado = () => (azar = (azar * 16807) % 2147483647) / 2147483647;
const muchas = Array.from({ length: 40 }, (_, i) => ({
  key: "m:" + i, kind: i % 5 ? "movie" : "tv",
  rating: 1 + Math.floor(dado() * 10),
  nota: i % 7 ? +(5 + dado() * 4).toFixed(1) : 0,
  motivos: [],
  features: [
    ...new Set(Array.from({ length: 6 + Math.floor(dado() * 8) }, () => "kw:" + Math.floor(dado() * 30))),
    "gen:" + [18, 28, 35, 16][i % 4], "gen:" + [18, 28, 35, 16][(i * 3) % 4],
  ],
  votos: 1000, generos: ["Drama"],
}));
const rapido = M.afinidadesSinCadaUna(muchas);
const largo = muchas.map((v, i) => M.afinidad(M.perfil(muchas.filter((_, j) => j !== i)), v.features, v.nota));
const peor = Math.max(...rapido.map((x, i) => Math.abs(x - largo[i])));
ok(peor < 1e-9, `mismo leave-one-out que rearmar el perfil (diferencia máxima ${peor.toExponential(1)})`);
// «De chico» sale del perfil entero, igual que «no tener en cuenta»: no pesa sus
// rasgos y tampoco entra como vecino, que era por donde se colaba con nota entera.
const conChico = muchas.map((v, i) => (i % 9 === 0 ? { ...v, motivos: ["de chico"] } : v));
const pChico = M.perfil(conChico), sinChico = muchas.length - Math.ceil(muchas.length / 9);
ok(pChico.total === sinChico, "«de chico» no cuenta en el perfil");
ok(pChico.vecinos.length === sinChico, "«de chico» tampoco opina como vecino");

console.log("\n--- 13. Series que \"solo si están muy buenas\" ---");
// Los números son los reales de TMDB para cada una.
const serieDe = (titulo, anio, idioma, generosIds, votos, nota, extra = {}) => ({
  key: "tv:" + titulo, kind: "tv", titulo, fecha: anio + "-01-01", votos, nota,
  detalle: { anio, generosIds, d: { original_language: idioma }, ...extra },
});
const candSeries = [
  serieDe("Scarlet Heart", 2016, "ko", [18, 10765], 600, 8.5),
  serieDe("Alice in Borderland", 2020, "ja", [10759, 9648], 2819, 8.1),
  serieDe("Un anime", 2019, "ja", [16, 10759], 900, 8.5),
  serieDe("Firefly", 2002, "en", [10759, 10765, 18], 2499, 8.3),
  serieDe("Battlestar Galactica", 2004, "en", [10765, 10759, 18], 1848, 8.2),
  serieDe("Merlín", 2008, "en", [10759, 18, 10765], 1192, 7.8),
  serieDe("Stargate Atlantis", 2004, "en", [10759, 10765], 1228, 8.0),
  serieDe("Anime viejo de ciencia ficción", 1998, "ja", [16, 10765], 1500, 8.5),
  serieDe("Ciencia ficción nueva", 2019, "en", [10765], 900, 8.0),
  serieDe("Roma", 2005, "en", [10759, 18], 1567, 8.2),
  { ...serieDe("Película coreana", 2019, "ko", [18], 600, 8.5), kind: "movie", key: "movie:ko" },
];
const quedan = M.filtrar(candSeries, { colecciones: new Set() }, { ...PREFS_CON_TODO, votosMinimos: 150 }).map(c => c.titulo);
console.log("  pasan:", quedan.join(" · "));
ok(!quedan.includes("Scarlet Heart"), "un K-drama con 8.5 y 600 votos no aparece: la nota sola no alcanza");
ok(quedan.includes("Alice in Borderland"), "una japonesa de imagen real que es un éxito, sí");
ok(quedan.includes("Un anime"), "el anime queda afuera de la regla de idioma");
ok(quedan.includes("Película coreana"), "la regla es de series: las películas no se tocan (Parásitos le gustó)");
ok(["Firefly", "Battlestar Galactica", "Merlín", "Stargate Atlantis"].every(t => !quedan.includes(t)),
   "ciencia ficción vieja: ni Firefly ni Battlestar ni Merlín, que son las que dijo que no");
ok(quedan.includes("Anime viejo de ciencia ficción"), "el anime viejo no paga lo de los efectos");
ok(quedan.includes("Ciencia ficción nueva"), "a la ciencia ficción nueva no se le pide nada extra");
ok(quedan.includes("Roma"), "lo viejo sin ciencia ficción no se toca: lo de Roma es una corazonada, no una regla");

console.log("\n--- 14. Series larguísimas: capítulo corto y muy buena, o nada ---");
const largas = [
  // Sin su género de ciencia ficción, para que la saque esta regla y no la otra
  serieDe("Supernatural", 2005, "en", [18, 9648], 8673, 8.3, { episodios: 327, dur: 45 }),
  serieDe("La Oficina", 2005, "en", [35], 5460, 8.6, { episodios: 186, dur: 23 }),
  serieDe("Construyendo un parque", 2009, "en", [35], 1912, 8.0, { episodios: 122, dur: 22 }),
  serieDe("My Hero Academia", 2016, "ja", [16, 10759, 10765], 5377, 8.6, { episodios: 170, dur: 24 }),
  serieDe("Larga sin duración", 2015, "en", [18], 5000, 8.7, { episodios: 150 }),
  serieDe("Mad Men", 2007, "en", [18], 1587, 8.1, { episodios: 92, dur: 47 }),
];
const conLargas = (extra = {}) => M.filtrar(largas, { colecciones: new Set() },
  { ...PREFS_CON_TODO, votosMinimos: 150, ...extra }).map(c => c.titulo);
const quedanLargas = conLargas();
console.log("  pasan:", quedanLargas.join(" · "));
ok(!quedanLargas.includes("Supernatural"), "327 capítulos de 45 minutos: no, aunque tenga 8.3");
ok(quedanLargas.includes("La Oficina"), "186 capítulos de 23 minutos y 8.6: sí");
ok(!quedanLargas.includes("Construyendo un parque"), "cortos pero con 8.0: no es «muuuy buena»");
ok(quedanLargas.includes("My Hero Academia"), "el anime también pasa por esta regla, y uno muy bueno la pasa");
ok(!quedanLargas.includes("Larga sin duración"), "si no se sabe cuánto dura el capítulo, no se puede decir que sea corto");
ok(quedanLargas.includes("Mad Men"), "92 capítulos: solo el descuento de siempre, no la vara");
ok(conLargas({ episodiosSoloMuyBuenas: 0 }).length === largas.length, "0 capítulos la apaga");

console.log("\n--- 15. Gente que puntúa como vos (tabla de vecinas) ---");
// Una tabla de mentira armada igual que armar-vecinas.py: triángulo de arriba, fila
// por fila, un byte por par.
const tablaDe = (tmdb, valor) => {
  const n = tmdb.length, tri = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) tri.push(valor(i, j));
  return { version: 1, hasta: "2023-10", mu: 3.5, tmdb, sesgo: tmdb.map(() => 0),
           triangulo: Buffer.from(Uint8Array.from(tri)).toString("base64") };
};
V.usar(tablaDe([11, 12, 13, 14, 15, 16], (i, j) => (i * 16 + j * 3) % 256));
let bienIndexada = true;
for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
  if (i === j) continue;
  const [a, b] = i < j ? [i, j] : [j, i];
  if (V.similitud(11 + i, 11 + j) !== ((a * 16 + b * 3) % 256) / 255) bienIndexada = false;
}
ok(bienIndexada, "el triángulo se lee igual que lo escribe numpy, en los dos órdenes");
// Y la v2: las K vecinas más parecidas de cada fila, guardadas ordenadas por índice.
// Mientras el par entre en las K de alguna de las dos filas, tiene que dar
// exactamente lo mismo que el triángulo entero.
const tablaV2De = (tmdb, valor, k) => {
  const n = tmdb.length;
  const sim = (i, j) => valor(Math.min(i, j), Math.max(i, j));
  const idx = new Uint16Array(n * k).fill(65535);
  const sims = new Uint8Array(n * k);
  for (let i = 0; i < n; i++) {
    const otras = [];
    for (let j = 0; j < n; j++) if (j !== i && sim(i, j) > 0) otras.push(j);
    otras.sort((a, b) => sim(i, b) - sim(i, a));
    otras.slice(0, k).sort((a, b) => a - b).forEach((j, p) => {
      idx[i * k + p] = j;
      sims[i * k + p] = sim(i, j);
    });
  }
  return { version: 2, k, hasta: "2023-10", mu: 3.5, tmdb, sesgo: tmdb.map(() => 0),
           indices: Buffer.from(idx.buffer).toString("base64"),
           similitudes: Buffer.from(sims).toString("base64") };
};
const seis = [11, 12, 13, 14, 15, 16];
const valor6 = (i, j) => (i * 16 + j * 3) % 256;
V.usar(tablaV2De(seis, valor6, 5));
let igualQueV1 = true;
for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
  if (i === j) continue;
  const [a, b] = i < j ? [i, j] : [j, i];
  if (V.similitud(11 + i, 11 + j) !== valor6(a, b) / 255) igualQueV1 = false;
}
ok(igualQueV1, "la v2 (las K más parecidas por fila) lee igual que el triángulo entero");

// Con K chico, lo que no entró en ninguna de las dos filas vale 0 y no rompe nada.
V.usar(tablaV2De(seis, valor6, 1));
ok(V.similitud(11, 16) >= 0 && V.similitud(11, 16) <= 1, "con K chico lo que quedó afuera vale 0");


// Dos grupos: 1-8 se parecen entre sí, 9-16 entre sí, y entre grupos nada. Le
// gustaron las del primero y no las del segundo.
const ids = Array.from({ length: 16 }, (_, i) => i + 1);
V.usar(tablaDe(ids, (i, j) => ((i < 8) === (j < 8) ? 200 : 0)));
const peli = (id, rating, extra = {}) => ({ key: "movie:" + id, kind: "movie", tmdbId: id, rating,
  titulo: "P" + id, features: [id <= 8 ? "gen:1" : "gen:2", "kw:" + id], nota: 7, motivos: [], ...extra });
const mias = [1, 2, 3, 4, 5, 6].map(id => peli(id, 9)).concat([9, 10, 11, 12, 13, 14].map(id => peli(id, 3)));
const pv = V.perfilDe(mias, M.pesoEnPerfil);
const del1 = V.predecir(pv, 7), del2 = V.predecir(pv, 15);
console.log(`  la 7 (grupo que le gusta): ${del1.nota.toFixed(1)} · la 15 (el otro): ${del2.nota.toFixed(1)} · por qué: ${del1.porQue.join(", ")}`);
ok(del1.nota > 7 && del2.nota < 5, "predice alto lo parecido a lo que le gustó y bajo lo parecido a lo que no");
ok(del1.porQue.every(t => ["P1", "P2", "P3", "P4", "P5", "P6"].includes(t)), "el «por qué» nombra las suyas que le gustaron");
const sin1 = V.sinCadaUna(pv).get("movie:1");
const sin1Otra = V.sinCadaUna(V.perfilDe(mias.map(v => v.tmdbId === 1 ? { ...v, rating: 1 } : v), M.pesoEnPerfil)).get("movie:1");
ok(Math.abs(sin1 - sin1Otra) < 1e-12, "la predicción de una suya no depende de la nota que le puso (dejar una afuera de verdad)");
const ofrece = V.mejores(pv, { excluir: new Set(["movie:8"]) }).map(x => x.tmdbId);
ok(ofrece[0] === 7 && !ofrece.includes(8) && !ofrece.some(id => id <= 6), "propone la 7 primero, respeta lo excluido y no ofrece lo ya puntuado");
const conEtiqueta = mias.map(v => v.tmdbId === 1 ? { ...v, motivos: ["no tener en cuenta"] } : v);
ok(V.perfilDe(conEtiqueta, M.pesoEnPerfil).fila.length === 11, "«no tener en cuenta» tampoco opina en la tabla de vecinas");
ok(V.perfilDe(mias.slice(0, 4), M.pesoEnPerfil) === null, "con menos de 5 películas en la tabla no inventa");

V.usar({ ...tablaDe(ids, (i, j) => ((i < 8) === (j < 8) ? 200 : 0)),
         anio: ids.map(id => id === 7 ? 1960 : 2010), animacion: ids.map(id => id === 8 ? 1 : 0) });
const pvF = V.perfilDe(mias, M.pesoEnPerfil);
const reglas = { anioMinimo: 2000, penalizarAnimacionOccidental: 1 };
const conReglas = M.candidatosVecinas({ mezcla: { pv: pvF, params: {} } }, { prefs: reglas }).map(c => c.tmdbId);
ok(!conReglas.includes(8), "no propone la animada, que sus reglas van a bajar igual");
// Lo viejo NO se corta acá. Para el resto de las fuentes "anterior al 2000" es un
// castigo más una vara de calidad, no una pared, y esta fuente cortaba más fuerte que
// todas: se perdían las mejores de imagen real que conoce la tabla sin que filtrar()
// llegara a verlas.
ok(conReglas.includes(7), "sí propone la de 1960: el castigo por vieja lo aplica filtrar(), no esta fuente");
const sinViejas = M.candidatosVecinas({ mezcla: { pv: pvF, params: {} } },
  { prefs: reglas, sinViejas: true }).map(c => c.tmdbId);
ok(!sinViejas.includes(7), "con el tilde de nada anterior al 2000, la de 1960 no se propone");
const sinReglas = M.candidatosVecinas({ mezcla: { pv: pvF, params: {} } }).map(c => c.tmdbId);
ok(sinReglas.includes(7) && sinReglas.includes(8), "sin esas reglas, las propone");

const mz = M.prepararMezcla(mias);
ok(mz.params && mz.loo.length === mias.length, "con la tabla, se mezcla y cada una tiene su predicción sin su nota");
const candMz = [{ ...peli(7, 0), detalle: { features: ["gen:1", "kw:7"] }, apoyo: 1, semillas: [] },
                { key: "tv:99", kind: "tv", tmdbId: 7, titulo: "Una serie", detalle: { features: ["gen:1"] }, nota: 7, votos: 500, apoyo: 1, semillas: [] }];
M.puntuar(candMz, { ...M.perfil(mias), mezcla: mz });
ok(candMz[0].vecinas && candMz[1].vecinas === null, "la película de la tabla se mezcla; la serie, aunque comparta id, va solo con el motor");
V.usar(null);
const sinTabla = M.prepararMezcla(mias);
ok(sinTabla.params === null && sinTabla.loo.every((x, i) => x === M.afinidadesSinCadaUna(mias)[i]),
   "sin tabla, la app queda exactamente como antes");

console.log("\n--- 16. Lo que le tienta y lo que no, desde la tarjeta ---");
const base16 = [
  { key: "m:a", titulo: "A", rating: 9, features: ["gen:28", "kw:1"], votos: 9000, dur: 120 },
  { key: "m:b", titulo: "B", rating: 8, features: ["gen:28", "kw:2"], votos: 9000, dur: 120 },
  { key: "m:c", titulo: "C", rating: 5, features: ["gen:35", "kw:3"], votos: 9000, dur: 120 },
  { key: "m:d", titulo: "D", rating: 6, features: ["gen:18", "kw:4"], votos: 9000, dur: 120 },
];
const viejaDrama = ["gen:18", "dec:1980", "kw:50"];
const sinReaccion = M.perfil(base16);
const noTienta = M.perfil(base16, { reacciones: [
  { features: ["gen:18", "dec:1980", "kw:51"], tienta: -1 },
  { features: ["gen:18", "dec:1990", "kw:52"], tienta: -1 },
] });
ok(M.afinidad(noTienta, viejaDrama) < M.afinidad(sinReaccion, viejaDrama), "dos «No me interesa» de dramas viejos bajan a otro drama viejo");
ok(noTienta.media === sinReaccion.media && noTienta.desvio === sinReaccion.desvio, "no mueven su media ni su desvío");
ok(noTienta.gustadas.length === sinReaccion.gustadas.length, "y no siembran");
const siTienta = M.perfil(base16, { reacciones: [{ features: ["gen:878", "kw:60"], tienta: 1 }] });
ok(M.afinidad(siTienta, ["gen:878", "kw:60", "kw:61"]) > M.afinidad(sinReaccion, ["gen:878", "kw:60", "kw:61"]),
   "«Me la guardo» sube lo que se le parece");
ok(M.afinidadVecinos(noTienta, viejaDrama, 20, true) === "D", "«a cuál de las tuyas se parece» nombra una que vio, no una reacción");

console.log("");
console.log("--- 17. La vara aprieta pero la pantalla no queda a medias ---");
const cand = (k, cf) => ({ key: k, confianza: cf });
const pasaron = [cand("a", 0.9), cand("b", 0.5)];
const afuera = [cand("c", 0.09), cand("d", -0.2), cand("e", 0.05), cand("b", 0.5)];
const relleno = M.completarCupo(pasaron, afuera, 4);
ok(pasaron.length + relleno.length === 4, "completa hasta el cupo pedido");
ok(relleno.map(c => c.key).join(",") === "c,e", "rescata las mejores primero, de mayor a menor");
ok(!relleno.some(c => c.key === "b"), "no repite una que ya había pasado la vara");
ok(relleno.every(c => c.avisos.includes(M.AVISO_RELLENO)), "el relleno va marcado, no se disfraza de recomendación");
ok(!afuera.some(c => c.avisos), "marca copias: no ensucia las rechazadas, que siguen sirviendo al diagnóstico");
ok(M.completarCupo(pasaron, afuera, 2).length === 0, "si ya alcanza el cupo, no rescata nada");
ok(M.completarCupo([], [], 20).length === 0, "sin nada afuera, devuelve vacío en vez de romper");

console.log("");
console.log("--- 18. «La dejé» cuenta como floja ---");
const [dej, dejBaja, entera] = M.comoGusto([
  { key: "a", rating: 7, motivos: ["la dejé"] },
  { key: "b", rating: 2, motivos: ["la dejé"] },
  { key: "c", rating: 9, motivos: [] },
]);
ok(dej.rating === M.TOPE_DEJADA && dej.puesta === 7, "dejada con 7: pesa como floja y la nota puesta no se pierde");
ok(dejBaja.rating === 2, "dejada con 2: no la sube al tope");
ok(entera.rating === 9 && entera.puesta === undefined, "la que terminó no se toca");

console.log("\n--- 19. Sin respaldo es apuesta; lo viejo de una época que no mira, afuera ---");
const mismaFicha = { dur: 140, features: F([53, 80], ["kw:1"]) };
const [conSuya, porKeyword] = M.puntuar([
  { key: "m:20", votos: 500000, nota: 8, apoyo: 1, semillas: [{ titulo: "A", aporte: 1 }], detalle: mismaFicha },
  { key: "m:21", votos: 500000, nota: 8, apoyo: 1, origen: "keyword", semillas: [{ titulo: "thriller", aporte: 1 }], detalle: mismaFicha },
], p).sort((a, b) => a.key.localeCompare(b.key));
ok(porKeyword.apuesta && porKeyword.avisos.includes(M.AVISO_SIN_RESPALDO),
   "la que trae una keyword avisa que es apuesta");
ok(porKeyword.confianza === conSuya.confianza, "pero no se le baja la nota: solo se marca");
ok(!conSuya.apuesta && !conSuya.avisos.includes(M.AVISO_SIN_RESPALDO), "la que trae una suya, no");
const clasico = { key: "m:22", kind: "movie", fecha: "1962-09-16", votos: 5000, nota: 8.5, detalle: { anio: 1962 } };
const reglaViejas = { anioMinimo: 2000, notaMinimaViejas: 8 };
ok(!M.filtrar([clasico], { colecciones: new Set(), anios: sinEpoca }, reglaViejas).length,
   "un clásico del 62 con 8.5 no pasa si de esos años no puntuaste nada");
ok(M.filtrar([clasico], { colecciones: new Set(), anios: conEpoca }, reglaViejas).length === 1,
   "con puntuadas de esa época, pasa");
const argentina = { key: "m:23", kind: "movie", fecha: "2009-08-13", votos: 2900, nota: 7.9, detalle: { anio: 2009 } };
const pConTabla = { colecciones: new Set(), mezcla: { params: { mc: 0 } } };
ok(!M.filtrar([argentina], pConTabla, { votosMinimos: 5000 }).length, "con 2.900 votos y nada que la respalde, no pasa el piso de 5.000");
ok(M.filtrar([{ ...argentina, vecinas: { apoyo: 5, puntaje: 0.4 } }], pConTabla, { votosMinimos: 5000 }).length === 1,
   "si la respalda la gente que puntúa como vos, alcanza con 2.500");

console.log("\n" + (fallos ? `${fallos} FALLAS` : "Todo verde."));
process.exit(fallos ? 1 : 0);
