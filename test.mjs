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

console.log("\n" + (fallos ? `${fallos} FALLAS` : "Todo verde."));
process.exit(fallos ? 1 : 0);
