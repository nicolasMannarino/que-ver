# Qué Ver

Recomendador de películas y series armado sobre **tus** puntuaciones.

La diferencia con pegarle tu lista a un chat: acá **el filtro de lo que ya viste
es código, no un prompt**. Nada que hayas puntuado, marcado como visto o descartado
puede volver a aparecer — se compara por id de TMDB, no por título. Y el modelo
nunca inventa títulos: todos salen del catálogo real.

## Arrancar

Necesitás Node 22 o más nuevo y una API key de TMDB — es gratis y sale en dos
minutos en [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api).

```
cd que-ver
cp .env.example .env      # y pegás tu key en TMDB_API_KEY
node server.mjs
```

Si preferís no usar `.env`, arrancá igual: la primera pantalla te pide la key y la
guarda en `data/config.json`.

> `data/` no está en el repo — adentro viven la key, las puntuaciones de cada
> perfil y el cache. Se crea solo la primera vez que arranca.

Te imprime dos direcciones:

```
en esta compu:  http://localhost:5173
en el celular:  http://192.168.0.2:5173   (misma red WiFi)
```

**En el celular**: abrís esa segunda dirección y, desde el menú del navegador,
*Agregar a pantalla de inicio*. Queda como una app, sin barra de navegador.
La primera vez Windows puede pedirte permitir Node en el Firewall: aceptá para
redes privadas.

`node test.mjs` corre los chequeos del motor y los parsers, sin red ni API key.
`node test-front.mjs` ejecuta el JavaScript de la página contra la API real con un
DOM de mentira — existe porque una variable que quedó de una versión anterior tiraba
ReferenceError, cortaba el bucle y dejaba la lista de puntuaciones vacía, y el chequeo
de sintaxis no lo veía.

## Perfiles

Arriba a la derecha elegís quién sos. Cada perfil tiene **sus propias puntuaciones,
sus preferencias y su historial** — lo de tu viejo no se mezcla con lo tuyo.
`+ perfil` crea uno nuevo, vacío.

## Las dos pantallas

**Recomendar.** Escribís el ánimo (o no) y le das. Cada tarjeta trae por qué te la
ofrece. Los botones:
- **Ya la vi** → abre la tira del 1 al 10 para puntuarla en el momento. Si no la
  querés puntuar, "la vi pero no la puntúo" la saca igual y no vuelve.
- **No me interesa** → nunca más.
- **Me la guardo** → a la lista de pendientes.

**Mis puntuaciones.** Todo lo que puntuaste, con póster, título linkeado a IMDb, tu nota y la de TMDB al lado
(para comparar), y con buscador y filtros por tipo
(películas / series / todo), por rango de puntaje y por orden. Desde ahí cambiás
notas, quitás títulos, y con **+ Agregar** buscás cualquier película o serie y la
puntuás aunque no estuviera en tu lista original.

**Descargar .txt / .csv** exporta tus puntuaciones. El `.txt` sale en el mismo
formato de bloc de notas (`10 Puntos: A, B, C`), así que lo podés usar en
cualquier otro lado — o volver a importarlo acá.

## Mis gustos

La tercera pestaña. Es lo que el motor aplica **además** de tus puntuaciones: tus notas
le enseñan qué te gusta, estas reglas le dicen qué no mostrarte. Se edita desde la app
y se guarda en `preferencias.json`.

- **Películas viejas**: las anteriores a `anioMinimo` no restan puntos, directamente
  **no aparecen** si no llegan a `notaMinimaViejas`. Es una vara, no un descuento.
- **Calidad mínima**: piso general de nota y de votos para cualquier recomendación.
  Sin esto la lista arranca bien y se cae a pique en el puesto 5.
- **Series**: bajar las que siguen al aire, y penalizar arriba de N capítulos.
- **Evitar**: keywords como `time loop` o `amnesia`. No toca los giros finales.
- **Animación infantil**: cuánto restarle. El anime está exento.
- **Estoy viendo ahora** y **Ya las vi**: no te las recomienda.
- **Notas sueltas**: texto libre. El motor todavía no lo usa; está para no perderlo.

Guardar limpia la cola de recomendaciones, así que la próxima búsqueda ya sale con las
reglas nuevas.

## ¿Funciona? — `node backtest.mjs`

Mide el motor contra tus propias puntuaciones: para cada título tuyo arma el perfil
**sin él** y ve qué puntaje le habría dado. Si el motor sirve, lo que puntuaste 8-10
tiene que quedar arriba de lo que puntuaste 1-6.

    AUC 0.742    0.50 = una moneda · 0.70 = útil · 0.80+ = bueno
    Spearman 0.429

Traducido: si agarrás una que te gustó y una que no, el motor las ordena bien 3 de
cada 4 veces. Útil, no mágico.

La mezcla de la fórmula de afinidad (mitad rasgos sueltos, mitad "a cuáles de las
tuyas se parece") se eligió corriendo esto, no a ojo: pasó de 0.724 a 0.742.

## Por qué no me gustó

La dimensión que él nombra siempre — "lenta", "mal llevada", "me tiene que atrapar en
20 minutos" — **no existe en TMDB**. Lo medí: la duración correlaciona 0.074 con sus
notas, "es solo drama" -0.023. Ningún campo la captura.

Así que la escribe él, **con sus palabras**. En cada fila de Mis puntuaciones hay un
"+ por qué no me gustó": una o dos palabras. Las que ya usó aparecen como sugerencia,
y los chips de arriba filtran por motivo.

**Con 3 títulos del mismo motivo** el motor busca qué rasgos comparten (keywords,
gente, temas — nunca géneros ni décadas, que son demasiado gruesos) y baja lo que se
les parece. La tarjeta avisa: *"se parece a las que marcaste «lenta»"*.

Ejemplo real con 6 marcadas como «lenta»: aprendió `gangster`, `period drama`,
`prison`, `nazi`. Contra eso, El Irlandés puntúa 1.96 y avisa; Mad Max 0.00 y no.

El motivo lo elige él a propósito: cuando las categorías las ponía yo ("lenta"), varias
películas no entraban en ninguna y la señal salía sucia.

## La pestaña "Puntuar"

Propone las más vistas que todavía no están en tu lista, de más a menos vista — si
viste algo, es probable que sea de esas. Cuatro salidas por título:

- **la nota del 1 al 10**
- **"no la vi"** y **"no me acuerdo"** la sacan de esta cola. **No la sacan de las
  recomendaciones**: no haberla visto es justamente motivo para recomendártela.
- **"la dejé"** para lo que empezaste y no terminaste: prende el modo y elegís la nota
  de lo que llegaste a ver. Queda con el motivo `la dejé`, que como señal vale más
  que el puntaje solo.

"Traer otras" avanza de página y el server sigue buscando hasta juntar 24 caras nuevas
— con 242 puntuadas las primeras páginas del catálogo ya están agotadas.

## Etiquetas

En cada fila de Mis puntuaciones hay un **desplegable de etiqueta**: `de chico`,
`lenta`, `mal llevada`, `predecible`, `no la entendí`, las que ya usaste, y "otra…"
para escribir la tuya. Una fila que ya tiene una etiqueta deja de ofrecerla.

- **«de chico»** baja el peso de ese título a un tercio y lo saca de las semillas. La
  nota sigue valiendo (Toy Story 10 es cierto) pero deja de mandar en lo que se
  recomienda hoy.
- **Los demás motivos**, con 3 títulos del mismo, arman un perfil de rasgos comunes y
  bajan lo que se les parece.

## "Más como esta"

En cada fila de Mis puntuaciones. Salta a Recomendar y busca en el vecindario de
**ese título**, no en el promedio de tu gusto.

Existe porque el gusto de él es **multi-modal**: estafas y engaños (Nueve reinas,
Focus, Atrápame si puedes, El robo del siglo), misterio con giro (El secreto de sus
ojos, Contratiempo), drama emocional (En busca de la felicidad, Sueño de fuga),
Marvel, Harry Potter, anime. **El promedio de todas esas zonas no es ninguna de
ellas**, y por eso la confianza global se estanca en 0.40 fuera del anime.

Con semilla cambian dos cosas: la confianza pasa a medir **parecido directo con esa
película** (Jaccard sobre sus rasgos) en vez de afinidad con el promedio, y se
relajan las varas de popularidad — el vecindario de Nueve reinas es cine latino,
que en TMDB tiene pocos votos y quedaba afuera.

## ¿Le achunta? El marcador contra la realidad

La app **anota lo que promete**. Cada vez que recomienda algo guarda el porcentaje
que le puso; cuando ese título se puntúa, compara. Arriba de Recomendar aparece:

    De las que te recomendé con 70% o más y después puntuaste:
    7 de 9 te gustaron (78%). Yo te había prometido 80% — le pega.

**Es la única medición que no está sesgada.** El backtest mide contra películas que
él ya había elegido ver; esto mide contra lo que la app eligió por él.

## Confianza

Cada recomendación muestra **qué porcentaje de lo que puntúa parecido le gustó**
(7 o más), no el puntaje crudo del modelo. La curva se calibra contra sus propias
notas con leave-one-out al construir el perfil (~300 ms).

Mostrar el puntaje crudo fue un error: leía "0.44" como "44% de posibilidades",
cuando en sus datos ese nivel acierta el 95%.

| puntaje interno | de las que puntúan parecido, le gustaron |
|---|---|
| 0.60+ | 100% |
| 0.45 | 95% |
| -0.20 a 0.35 | 84% |
| -0.40 | 58% |

**El número con el que comparar:** eligiendo él, le pone 7 o más al **66%** de lo
que ve. La app en su banda media acierta 84%.

**La advertencia honesta:** medido sobre películas que él ya eligió ver, que es una
muestra sesgada a favor. En el catálogo entero va a acertar menos.

## Lo ya mostrado vuelve

"Ya te lo mostré" vale para **la búsqueda actual**, no para siempre. Antes se
acumulaba sin límite: a las 63 el pozo se secaba, y algo que le había interesado y
no marcó desaparecía sin manera de volver a encontrarlo. Apretar "Dame algo para
ver" pone todo en juego otra vez; "mostrame otras" sigue bajando sin repetir.

Lo que **sí** desaparece para siempre es lo que puntuó, lo que marcó como visto y
lo que descartó con "No me interesa".

## Mis guardadas

Botón arriba de Recomendar. Sin esto, "Me la guardo" no llevaba a ningún lado.

## El orden es una cola, no una consulta nueva

Con los mismos filtros, "mostrame otras" sigue bajando por **la misma lista
ordenada**. Antes cada tanda era una consulta nueva sobre un pozo distinto, así
que la segunda podía traer algo mejor que la primera — y eso no es estar ordenado.
Se arma una cola de 60 una vez y se sirve por pedazos; cuando se agota, lo nuevo
entra sólo si no supera lo último servido.

## Géneros: un clic incluye, dos excluyen

Los chips de género tienen tres estados: neutro → **solo de este género** →
**nunca de este género**. Hace falta porque hay géneros de los que no tiene casi
datos: tenía **una sola** película de terror puntuada, así que el motor no podía
aprender que no le gustan.

## Variedad

Cada tarjeta dice **a cuál de sus películas se parece**, y no entran más de dos
que salgan de la misma. Sin eso salían cinco dramas argentinos seguidos, todos
colgados de El secreto de sus ojos.

## Cómo decide

**1. Resuelve tus puntuaciones contra TMDB.** Entiende tres formatos: el export de
IMDb (CSV), una línea por título, y el agrupado (`10 Puntos: A, B, C`). Para los
títulos difíciles prueba variantes — `El origen (Inception)` busca primero
"Inception" — y para los numerados usa la colección: `Harry Potter 3` no existe
como título, pero es la tercera de la colección por fecha de estreno.

Cuando hay varios candidatos, elige por **votos acumulados + un premio por título
exacto**, nunca por popularidad: popularity mide lo que está de moda esta semana
y elegía el remake (Avatar 2024) o el spin-off (La casa del dragón le ganaba a
Game of Thrones 172 a 165 con la cuarta parte de votos).

**2. Arma el perfil.** Cada género, keyword, director y actor pesa según cuánto se
despegan de *tu* media las películas donde aparece. **Lo que puntuaste bajo resta.**

**3. Busca candidatos por tres vías.**

- **Vecinos**: `recommendations` y `similar` de lo que puntuaste alto.
- **Por tu perfil**: otras de tus directores más fuertes, y pelis/series por tus
  keywords. Existe porque la primera vía es data de co-visitas y solo devuelve
  secuelas y taquilleras.
- **Catálogo por género, paginado**: la de fondo, que no se agota. Las dos anteriores
  son finitas: después de ~110 títulos ofrecidos no quedaba nada y "Mostrame otras"
  se quedaba mudo. Esta barre tus géneros y va avanzando de página.

Los filtros de tipo (Película / Serie) y de género viajan **hasta las fuentes**, no se
aplican al final: si no, el motor gastaba los 120 candidatos que enriquece en películas
y con el chip "Serie" quedaban tres.

**4. Filtra fuerte.** Fuera lo ya visto, lo no estrenado, lo que tiene menos de 30
votos y **otra de una saga que ya puntuaste**.

**5. Puntúa y diversifica**, para que ni un género ni una saga se lleven la lista.

## Los archivos que podés tocar

Todo vive en `data/usuarios/<perfil>/`.

### `preferencias.json`
Reglas que las puntuaciones no enseñan solas. Se releen en cada búsqueda: editás y
recargás la página.

| | |
|---|---|
| `anioMinimo` + `notaMinimaViejas` | Lo anterior a ese año solo aparece si llega a esa nota. |
| `notaMinima` + `votosMinimos` | Piso de calidad para todo. |
| `seriesTerminadas` | Las que siguen al aire pierden puntos. |
| `maxEpisodios` | Arriba de 60 empieza a restar, cada vez más. |
| `bonusCapituloCorto` | Capítulos de 35 min o menos suman. |
| `evitarKeywords` | `time loop`, `amnesia`… No incluye giros finales, que sí te gustan. |

| `penalizarMotivos` | Cuánto bajar lo que se parece a las que marcaste con un motivo. |
| `penalizarEfectosViejos` | Ciencia ficción y fantasía anteriores a `anioMinimo`: los efectos son lo que peor envejece. |
| `penalizarFamilia` | Género Familia en imagen real: el mismo cluster de infancia que Disney, pero la regla de animación no lo toca. |
| `penalizarInfantil` | Animación + Familia, no japonesa. |
| `penalizarAnimacionOccidental` | Cualquier animación no japonesa. **El anime queda exento a propósito**: sus dieces de animación son de la infancia, pero el anime sí lo mira hoy. |
| `viendoAhora` | Se marcan como vistas al importar. |
| `yaVistas` | Lo que viste pero nunca puntuaste. |

### `mapeo.json`
Correcciones a mano cuando un título se resuelve mal. Acepta un id (`"movie:240"`)
o un mejor término de búsqueda. Manda sobre todo lo demás. Hace falta cuando TMDB
escribe el título distinto: `Seven` no se encuentra porque allá es **Se7en**.

### `puntuaciones.json`
Tu lista, ya resuelta. Es la fuente de verdad: la app la edita sola cuando puntuás.

## Archivos del código

| | |
|---|---|
| `server.mjs` | HTTP, rutas, orquestación |
| `datos.mjs` | perfiles, store de puntuaciones, filtros, exportar |
| `motor.mjs` | perfil de gusto, candidatos, preferencias, scoring, diversidad |
| `ratings.mjs` | los tres parsers y las variantes de búsqueda |
| `tmdb.mjs` | cliente de TMDB con cache en disco |

Los títulos se piden en **es-MX** (español latino), que es el que usás vos:
"Buenos Muchachos" y no "Uno de los nuestros".

## Si algo no cierra

- **Te recomienda algo que ya viste**: si nunca lo puntuaste, la app no lo sabe.
  Usá "Ya la vi" o cargalo en `yaVistas`.
- **Un título quedó mal resuelto**: ponelo en `mapeo.json` con el id correcto,
  borrá `puntuaciones.json` de ese perfil y reimportá.
- **Dos títulos tuyos en la misma ficha**: la app lo detecta y te dice cuáles.
- **Empezar de cero**: borrá `data/usuarios/<perfil>/puntuaciones.json` (reimporta),
  `estado.json` (olvida descartes) o `data/cache/` (vuelve a pedir todo a TMDB).
