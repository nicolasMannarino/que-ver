// Prueba de parsers + motor con datos sintéticos (sin red, sin API key).
import fs from "node:fs";
import { PREFS_POR_DEFECTO } from "./datos.mjs";
import { parseImdbCSV, parseNotepad, mergeRatings, parseAgrupado, variantesBusqueda } from "./ratings.mjs";
import * as M from "./motor.mjs";

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
// Las preferencias por defecto, no las de un usuario: el test no depende de datos
const prefs = PREFS_POR_DEFECTO;
const P = (extra) => M.preferencias(extra, prefs);

const vieja = P({ kind: "movie", nota: 7.0, detalle: { anio: 1995, kwNames: [] } });
console.log("  peli del 95, nota 7.0 ->", vieja.ajuste.toFixed(2), JSON.stringify(vieja.notas));
ok(vieja.ajuste < 0, "peli anterior a 2000 pierde puntos");

const viejaBuena = P({ kind: "movie", nota: 8.6, detalle: { anio: 1972, kwNames: [] } });
console.log("  peli del 72, nota 8.6 ->", viejaBuena.ajuste.toFixed(2), JSON.stringify(viejaBuena.notas));
ok(viejaBuena.ajuste > vieja.ajuste, "si es de las muy buenas, la penalización de época casi no pega");

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
// uno. Tiene que dar lo mismo, con nostalgia, rasgos repetidos y títulos sin nota.
let azar = 7;
const dado = () => (azar = (azar * 16807) % 2147483647) / 2147483647;
const muchas = Array.from({ length: 40 }, (_, i) => ({
  key: "m:" + i, kind: i % 5 ? "movie" : "tv",
  rating: 1 + Math.floor(dado() * 10),
  nota: i % 7 ? +(5 + dado() * 4).toFixed(1) : 0,
  motivos: i % 9 === 0 ? ["de chico"] : [],
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
const quedan = M.filtrar(candSeries, { colecciones: new Set() }, { ...PREFS_POR_DEFECTO, votosMinimos: 150 }).map(c => c.titulo);
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
  { ...PREFS_POR_DEFECTO, votosMinimos: 150, ...extra }).map(c => c.titulo);
const quedanLargas = conLargas();
console.log("  pasan:", quedanLargas.join(" · "));
ok(!quedanLargas.includes("Supernatural"), "327 capítulos de 45 minutos: no, aunque tenga 8.3");
ok(quedanLargas.includes("La Oficina"), "186 capítulos de 23 minutos y 8.6: sí");
ok(!quedanLargas.includes("Construyendo un parque"), "cortos pero con 8.0: no es «muuuy buena»");
ok(quedanLargas.includes("My Hero Academia"), "el anime también pasa por esta regla, y uno muy bueno la pasa");
ok(!quedanLargas.includes("Larga sin duración"), "si no se sabe cuánto dura el capítulo, no se puede decir que sea corto");
ok(quedanLargas.includes("Mad Men"), "92 capítulos: solo el descuento de siempre, no la vara");
ok(conLargas({ episodiosSoloMuyBuenas: 0 }).length === largas.length, "0 capítulos la apaga");

console.log("\n" + (fallos ? `${fallos} FALLAS` : "Todo verde."));
process.exit(fallos ? 1 : 0);
