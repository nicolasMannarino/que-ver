# Qué Ver

Recomendador de películas y series armado sobre **tus** puntuaciones.

La diferencia con pegarle tu lista a un chat: acá **el filtro de lo que ya viste
es código, no un prompt**. Nada que hayas puntuado, marcado como visto o descartado
puede volver a aparecer — se compara por id de TMDB, no por título. Y el modelo
nunca inventa títulos: todos salen del catálogo real.

## Arrancar

Necesitás Node 22 o más nuevo y una API key de TMDB — es gratis y sale en dos
minutos en [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api).

**En Windows, doble clic en `que-ver.bat`** y listo: baja la última versión —la
misma que está publicada en la web—, instala lo que falte, levanta el server y te
abre el navegador cuando ya contesta. Si tenés cambios sin commitear, no baja nada
y te avisa que estás corriendo tu versión y no la publicada.

A mano es lo mismo:

```
cd que-ver
node server.mjs
```

La primera pantalla te pide la API key y la guarda en `data/config.json`.

> `data/` no está en el repo — adentro viven la key, las puntuaciones de cada
> perfil y el cache. Se crea solo la primera vez que arranca.

**El server escucha sólo en `localhost`.** En este modo la app abre tus datos sin
pedir contraseña, así que atada a toda la red cualquiera en el mismo WiFi entra y
los edita. Para el celular está la app publicada, que sí pide contraseña. Si
igual la querés abrir en una red de confianza: `HOST=0.0.0.0`.

### Ver en tu compu lo mismo que en la web

Por defecto son dos mundos: acá los archivos de `data/`, allá la base. Puntuás en
el celular y en la compu no está.

Para que sean **la misma app**, copiá `.env.example` a `.env` y pegá las dos
variables que ya tiene Render (*tu servicio → Environment*):

```
DATABASE_URL=...      la connection string de Neon, la "pooled"
SESSION_SECRET=...    el mismo de Render, letra por letra
```

Doble clic en `que-ver.bat` y listo — al arrancar te dice cuál de los dos mundos
estás mirando. A mano es `node --env-file=.env server.mjs`: **el server no lee
`.env` solo**, y `node server.mjs` a secas lo ignora.

Que `SESSION_SECRET` sea el mismo no es un detalle: con otro, la app arranca
igual pero no puede descifrar tu API key de TMDB y te la pide de nuevo.

**Ojo con la primera vez.** Al prender el `.env` vas a ver lo que hay **en la
nube**, no los archivos de `data/`. Si tus puntuaciones nunca subieron, el perfil
te va a aparecer vacío — y no se perdió nada: `data/` sigue intacto, apagás el
`.env` y vuelve. Para mirar qué hay arriba antes de cambiar nada:

```
node --env-file=.env subir-mis-datos.mjs --mail vos@ejemplo.com --ensayo
```

`--ensayo` no escribe: sólo dice qué haría. Sacándolo, sube lo de esta compu.

`.env` está en `.gitignore` y el `.bat` lo verifica en cada arranque. Esas dos
líneas juntas son acceso completo a la base y a las API keys de todos: no van a
un chat, ni a un issue, ni a un mail.

`node test.mjs` corre los chequeos del motor y los parsers, sin red ni API key.
`node test-auth.mjs` levanta el server en modo publicado, sobre un `data/` descartable,
y verifica lo que tiene que ser cierto para dejar esto en internet: que sin cuenta no
se lee ni se escribe nada, que cambiar `?u=` no te da el perfil de otro, y que la
contraseña no queda guardada en texto plano en ningún lado.
`node test-front.mjs` ejecuta el JavaScript de la página contra la API real con un
DOM de mentira — existe porque una variable que quedó de una versión anterior tiraba
ReferenceError, cortaba el bucle y dejaba la lista de puntuaciones vacía, y el chequeo
de sintaxis no lo veía.

`node test-almacen.mjs` y `node test-dos-instancias.mjs` prueban que tu compu y la
web sean la misma app y no dos parecidas. Necesitan un Postgres descartable, y sin
él se saltean solos:

```
docker run -d --name qv-pg-test -e POSTGRES_PASSWORD=qv -p 5433:5432 postgres:16-alpine
set TEST_DATABASE_URL=postgres://postgres:qv@localhost:5433/postgres?sslmode=disable
node test-almacen.mjs && node test-dos-instancias.mjs
```

El segundo levanta **dos servers contra la misma base** —uno hace de Render y otro
de tu escritorio—, puntúa en uno y exige verlo en el otro, en las dos direcciones.
Los dos se niegan a correr si `TEST_DATABASE_URL` apunta a algo alojado: borran las
tablas antes de empezar.

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
- **Drama hablado y nada más**: baja lo que solo es drama, romance, historia o
  documental. Es lo que él pidió — *"si una película es 100% hablada sin un poquito
  de acción o alguna cosita más es difícil que realmente me guste"* — y va como
  regla declarada, no como hallazgo: medido sobre sus 284, tener o no un género de
  movimiento **no predice nada** (correlación -0.001, 70% de gusto de los dos lados).
  Crimen y misterio cuentan como movimiento, así que las estafas y los giros no se
  tocan; comedia, animación y familia también quedan afuera, porque una comedia no
  es un drama hablado y esas dos ya tienen su propia regla.
- **Animación infantil**: cuánto restarle. El anime está exento.
- **Estoy viendo ahora** y **Ya las vi**: no te las recomienda.
- **Notas sueltas**: texto libre. El motor todavía no lo usa; está para no perderlo.

Guardar limpia la cola de recomendaciones, así que la próxima búsqueda ya sale con las
reglas nuevas.

## ¿Funciona? — `node backtest.mjs`

Mide el motor contra tus propias puntuaciones: para cada título tuyo arma el perfil
**sin él** y ve qué puntaje le habría dado. Si el motor sirve, lo que puntuaste 8-10
tiene que quedar arriba de lo que puntuaste 1-6.

    AUC 0.745    0.50 = una moneda · 0.70 = útil · 0.80+ = bueno
    Spearman 0.386

Traducido: si agarrás una que te gustó y una que no, el motor las ordena bien 3 de
cada 4 veces. Útil, no mágico.

**Estuvo mudo un tiempo.** Leía la key con `leer(DATA + "/config.json")`, pero
"config.json" es la *clave* del almacén y `leer` ya la resuelve contra `data/`:
quedaba `data/C:/.../data/config.json`, que no existe. Sin key, `fichas()`
devolvía cero títulos y el backtest imprimía **NaN** en las cuatro métricas sin
decir por qué. Los números de acá arriba son de después de arreglarlo.

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

## La vara: 8 de cada 10 con nota 8

Él lo pidió así: *"de 10 películas me tienen que gustar para un 8 más o menos 8"*.
No era un capricho: **se puede**, y el número sale de sus propias notas.

Midiendo leave-one-out sobre sus 284, agrupadas por el puntaje que les habría dado
el motor:

| vara | de 10, cuántas puntuó 8+ | cuántas sobreviven en 4 tandas |
|---|---|---|
| 0 — como estaba | 5.3 | 30, con relleno |
| 0.3 | 6.8 | 24 |
| 0.5 | 7.5 | 18 |
| **0.7** | **8.4** | **10** |
| 1.0 | 8.6 | 5 |

Su línea de base eligiendo él: 8+ en el 39%, o sea **3.9 de 10**.

**El bug:** `confianzaMinima: 0.3` estaba escrita en las preferencias por defecto
desde el principio y **no la leía ningún archivo**. El filtro real era `>= 0`
escrito a mano, así que entraba cualquier cosa que no fuera negativa. Pidiendo 60,
de 30 tarjetas que salían **18 estaban debajo de 0.3**: relleno con el que la lista
se veía llena y no servía.

**El segundo bug, el que hacía que se repitieran siempre las mismas:** el bucle que
cava en el catálogo cortaba al juntar `n` candidatos *cualesquiera*. Como el relleno
llenaba el cupo rápido, **dejaba de buscar justo cuando todavía había buenas más
adentro**. Ahora cuenta sólo las que pasan la vara y cava hasta 10 saltos: aparecieron
Demon Slayer, Dragon Ball Super, Paprika, 5 centímetros por segundo y El regreso del
gato, que antes no salían nunca.

**El precio, dicho claro:** con la vara en 0.7 son ~10 títulos por búsqueda y después
la lista se queda vacía a propósito — prefiere quedarse corta antes que rellenar. Y
esos 10 son casi todos anime y Ghibli, porque ahí es donde su 8+ está concentrado.
Más variedad y más aciertos tiran para lados opuestos. La perilla está en Mis gustos.

## «No tener en cuenta»: sacar una nota del perfil

Etiqueta nueva en Mis puntuaciones. La nota queda —Toy Story 10 es cierto— pero el
título **sale del perfil entero**: no pesa, no es vecino, no puede ser semilla y no
calibra. Es más fuerte que «de chico», que solo baja el peso a 0.35.

La pidió él sospechando que sus 30 animadas de Disney/Pixar le estaban copando las
recomendaciones. **Lo medí y la sospecha no se sostiene:** sacándolas, el peso del
género Animación **sube** de 2.882 a 3.183. Sus 7 anime promedian **8.86**, el grupo
más alto de toda su lista, y son ellos —no la nostalgia— los que sostienen la señal.
La normalización por raíz de frecuencia hace el resto: al sacar 30 títulos tibios y
dejar 7 extremos, la señal se concentra en vez de diluirse.

La etiqueta queda igual porque sirve para lo que sirve. Pero para este problema no
es la herramienta.

## Por qué «Sin animación» deja la lista vacía

No es sesgo: son **dos escalas distintas**. Medido leave-one-out sobre sus 285:

| | máximo | mediana |
|---|---|---|
| animadas (37) | 1.62 | 0.63 |
| imagen real (248) | 1.03 | **-0.17** |

Y las de imagen real que llegan arriba son **los ocho Harry Potter**, que ya puntuó y
por lo tanto nunca se recomiendan. En el catálogo sin ver, lo mejor de imagen real
toca **0.37**. Con la vara en 0.7 no pasa nada, y no hay número de vara que arregle
eso: el pozo no tiene con qué.

Es lo que el README ya decía en «Más como esta» —*la confianza global se estanca en
0.40 fuera del anime*— porque su gusto de imagen real es multi-modal: estafas,
misterio con giro, drama emocional, Marvel. El promedio de esas zonas no es ninguna.

**La herramienta que sí funciona ahí es «Más como esta».** Con semilla la confianza
pasa a medir parecido directo con ESE título y rompe el techo: desde Nueve Reinas da
El aura 0.78; desde El secreto de sus ojos, El aura 0.89 y El hijo de la novia 0.75.

## ¿Le achunta? El marcador contra la realidad

La app **anota lo que promete**. Cada vez que recomienda algo guarda el porcentaje
que le puso; cuando ese título se puntúa, compara. Arriba de Recomendar aparece:

    De las que te recomendé con 70% o más y después puntuaste:
    7 de 9 te gustaron (78%). Yo te había prometido 80% — le pega.

### Solo cuenta lo que vio POR la recomendación

Él lo preguntó así: *"si me recomendó algo y lo puntué después de verla, ¿cómo sabe
que lo puntué después de verla y no porque ya la había visto?"*. No lo sabía. La
única condición para anotarse un acierto era que el título tuviera una predicción
pendiente, sin mirar de dónde venía el puntaje — y hay **cinco** caminos hacia
`/api/puntuar`: la tarjeta, editar una nota vieja, "+ Agregar", "la dejé" y la
pestaña Puntuar, que es literalmente una lista de cosas que ya vio.

El sesgo iba **siempre a favor de la app**: le mostraba algo que él ya había visto
hacía años y le había encantado, tocaba 9, y quedaba anotado como gol propio sin
haber causado nada.

Ahora la tarjeta pregunta primero y la nota va después:

> **¿La viste por esta recomendación, o ya la habías visto de antes?**
> `La vi por acá` · `Ya la había visto`

Solo la primera cuenta. La segunda guarda la nota igual pero queda fuera del
marcador, y la banda lo dice en voz alta: *"No cuento otras N que puntuaste pero ya
habías visto de antes: esas no las gané yo"*. Los otros cuatro caminos no mandan la
marca, así que **ninguno** puede resolver una predicción.

Sigue estando **menos sesgada que el backtest** — mide contra lo que la app eligió,
no contra lo que él ya había elegido ver — pero ya no se anota mérito ajeno.

## Confianza

Cada recomendación muestra **qué porcentaje de lo que puntúa parecido le gustó**
(7 o más), no el puntaje crudo del modelo. La curva se calibra contra sus propias
notas con leave-one-out al construir el perfil (~650 ms).

Mostrar el puntaje crudo fue un error: leía "0.44" como "44% de posibilidades",
cuando en sus datos ese nivel acierta bastante más.

| puntaje interno | de las que puntúan parecido, le gustaron | sobre cuántas |
|---|---|---|
| 0.32+ | 94% | 64 |
| 0.07 a 0.32 | 78% | 35 |
| -0.22 a 0.07 | 68% | 72 |
| -0.40 a -0.22 | 59% | 64 |
| bajo -0.40 | 48% | 49 |

**El número con el que comparar:** eligiendo él, le pone 7 o más al **70%** de lo
que ve.

**La advertencia honesta:** medido sobre películas que él ya eligió ver, que es una
muestra sesgada a favor. En el catálogo entero va a acertar menos.

### Por qué antes decía 96% de casi todo

Él lo dijo así: *"no me dan ganas de verlas varias que están como que van a ser
películas que me van a gustar sí o sí"*. Tenía razón, y era un bug con dos mitades.

La curva se armaba con **una de cada tres** de sus puntuaciones (90 de 284) y sin
piso de tamaño por tramo. La regresión isotónica sobre datos binarios siempre
termina en bloques puros, así que los **20 tramos de arriba tenían una sola
película cada uno** y publicaban 100% — la tarjeta lo mostraba como 96% — porque
esa única película le había gustado. Abajo pasaba lo contrario: un solo bloque de
40 observaciones cubría de -0.30 a 0.23 y decía **73% para todo**, que es justo
donde cae casi toda recomendación real.

Resultado: en cuatro tandas seguidas, las 48 tarjetas decían entre 73% y 96%. El
número no distinguía nada.

Ahora la curva usa **las 284**, ningún tramo se publica con menos de 20
observaciones adentro (si no llega, se fusiona con el vecino) y encima se encoge
hacia su tasa base con un prior de 8. Quedan cinco niveles reales —
48 / 59 / 68 / 78 / 94 — sostenidos por entre 35 y 72 títulos cada uno.

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

## «Mostrame otras» tardaba 21 segundos

Él: *"tarda MUCHÍSIMO"*. Tenía razón y era un bug de contabilidad.

Hasta dónde se había cavado en el catálogo salía de `mostradas.length / 24`. Pero
desde que hay vara, una ronda puede devolver **cero** — y entonces `mostradas` no
crece, el número no avanza, y el clic siguiente le pide a TMDB **exactamente las
mismas páginas**. Con el cache frío son ~100 consultas de discover más hasta 600
fichas, cada vez, para volver a devolver cero.

Dos arreglos:

- **La profundidad se guarda y siempre avanza** (`estado.profundidadCatalogo`). Cada
  clic mira páginas nuevas. Además de rápido, ahora trae cosas distintas: aparecieron
  Superman II, Godzilla: Guerra final y Preparatoria Halloween donde antes no salía
  nada. Al pasar la página 400 vuelve a empezar, que para entonces está todo cacheado.
- **Presupuesto de tiempo, no de vueltas**: la excavación corta a los 6 segundos. Como
  la profundidad quedó guardada, el clic siguiente sigue desde donde dejó.

Medido, con «Sin animación» puesto:

    antes:  1.4s · 21.0s · 12.5s · 4.7s · 4.7s
    ahora:  3.1s ·  2.1s ·  1.3s · 0.9s · 0.9s

## Filtro de duración

En Recomendar: **«Que no dure más de N minutos»**. En series mide el capítulo, que es
lo que importa para «tengo hora y media». Si TMDB no sabe cuánto dura, la deja pasar:
sacarla por falta de dato es peor que mostrarla con el número en blanco.

Viaja hasta las fuentes (`with_runtime.lte`), así que no gasta el presupuesto trayendo
epopeyas de tres horas para descartarlas al final — y de paso destapa páginas nuevas.

## El filtro filtra, no inventa

Los chips de género son una **vista sobre la misma lista**, no una consulta nueva.

Antes no: el género entraba en la firma de la cola, así que tocar «Comedia»
rearmaba todo pidiéndole comedias a TMDB desde cero. Medido: de 8 títulos que
salían al filtrar, **8 no estaban en la lista de antes**. Y si al filtrar aparece
una comedia al 94% que sin filtro nunca ofreció, lo que eso dice es que la lista
sin filtrar no estaba mostrando lo mejor que tenía.

Ahora el género saca las que no son y sube las que sí: las 6 comedias que estaban
en los puestos 9, 12, 14, 19, 30 y 40 pasan a los primeros lugares. Solo si no
alcanzan sale a buscar más, y esas van al final **con un cartel que lo dice**.

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

## Publicarlo

Corre igual en dos modos, y lo que decide cuál es **si existe `DATABASE_URL`**:

| | en tu compu | publicado |
|---|---|---|
| entrar | directo | mail y contraseña |
| datos | archivos en `data/` | Postgres |
| API key de TMDB | una, en `data/config.json` | **la de cada uno**, cifrada contra su cuenta |

En tu compu no cambia nada: sin `DATABASE_URL` no hay login ni pantalla de entrar,
y seguís abriendo `localhost:5173` como siempre.

### Los pasos

1. **Base**: cuenta en [neon.tech](https://neon.tech), proyecto nuevo, y copiás la
   connection string (la *pooled*).
2. **Hosting**: en [render.com](https://render.com), *New → Blueprint*, apuntás a este
   repo. El `render.yaml` ya dice todo lo demás. Pegás `DATABASE_URL` cuando la pida;
   `SESSION_SECRET` lo genera Render solo.
3. **Tu cuenta**: entrás a la URL que te da Render, *No tengo cuenta*, y pegás tu API
   key de TMDB.
4. **Tus puntuaciones**, para no empezar de cero:

   ```
   node subir-mis-datos.mjs --url "<la DATABASE_URL>" --mail vos@ejemplo.com
   ```

   Agregale `--ensayo` para ver qué haría sin escribir nada.

### Quién puede entrar

**Nadie que vos no habilites.** La primera cuenta que se crea es la del dueño; a
partir de ahí, para registrarse hace falta un **código de invitación** que genera
el dueño desde la app (botón *invitaciones*). Un desconocido que llegue a la URL
ve la pantalla de entrar y no tiene por dónde seguir.

Los códigos se guardan **hasheados**, igual que las contraseñas: quien se lleve un
backup de la base no se lleva invitaciones usables. Cada uno tiene tope de usos y
fecha de vencimiento, y se pueden dar de baja antes.

Las contraseñas van con scrypt y sal propia, mínimo 10 caracteres, y se rechazan
las que aparecen en toda filtración, las de un solo tipo de caracter y las que
contienen tu propio mail.

*Cerrar sesión en todos los dispositivos* existe por si perdés el celular: la
cuenta lleva un número de versión y subirlo de uno deja vieja a toda cookie
emitida hasta ese momento.

### El cache tiene que sobrevivir al reinicio

Armar una búsqueda son ~120 pedidos a TMDB y armar el perfil otros 284. Medido:

    cache lleno      0,8 s
    cache vacío     34   s

En Render el disco se borra cada vez que la instancia se despierta, así que **cada
sesión empezaba fría** y esos 34 segundos se los comía el que entraba.

Por eso el cache es de tres niveles: **disco → Postgres → TMDB**. Lo estable (las
fichas, las recomendadas, las colecciones) se guarda gzipeado en la base y
sobrevive los reinicios; lo que cambia seguido no. Una ficha con créditos y
keywords pesa ~100 KB en JSON y ~10 KB comprimida: 285 fichas son 4 MB, contra el
medio giga del plan gratis de Neon.

Y se piden **de a muchas en una sola consulta**: una por una eran 284 idas y
vueltas a la base, 14 segundos; juntas, 3.

### Lo que hay que saber del plan gratis

- **Se duerme a los 15 minutos sin visitas** y la primera carga después tarda cerca de
  un minuto en despertar. Peor: al reiniciar se borra el disco, así que el cache
  arranca vacío. Con `MANTENER_DESPIERTO=9-1` la app se pide una página a sí misma
  cada diez minutos dentro de ese horario y no se duerme. Render da 750 horas de
  instancia por mes y el mes tiene 730, así que 24 horas entra justo y sin margen:
  por eso va por ventana. De 9 a 1 son ~500 horas.
- **La CPU del plan gratis es un núcleo compartido**, entre 1 y 8 veces más lenta que
  una de escritorio y variable de minuto a minuto. Medible en `/api/pulso`. Es el
  techo de lo que se puede mejorar sin pagar.
- **Ya no hay una sola instancia.** Esto valía mientras la app de la compu usaba sus
  archivos y la publicada su base. Ahora las dos van contra la misma, y cómo no se
  pisan está abajo.

### Dos instancias, una sola verdad

La app de tu compu y la publicada son **la misma app**: la misma base, las mismas
puntuaciones, las mismas etiquetas. Puntuás en el celular y está en la compu; la
etiquetás en la compu y está en el celular. Sin exportar, sin importar, sin
acordarte de sincronizar.

Eso rompía el supuesto sobre el que estaba escrito el almacén. El server **carga
todo a memoria al arrancar** y desde ahí contesta, que es lo que hace que una
búsqueda cueste 0,8 s y no 14. Con un solo proceso eso es correcto. Con dos, la
foto de uno envejece apenas el otro escribe — y lo grave no es leer viejo, es
**guardar**: `puntuaciones.json` se escribe entero, así que la instancia
desactualizada le devolvía a la base su copia vieja y se llevaba puesto todo lo
que la otra había anotado desde que arrancó.

Dos arreglos, los dos chicos:

- **Antes de contestar cualquier `/api/`, traer lo que cambió.** No la base
  entera: sólo las filas con `actualizado > la última marca`, que casi siempre
  son cero. La marca es la del reloj **de la base** y no la de la máquina —dos
  procesos no tienen por qué tener la misma hora, y un segundo de adelanto se
  come un cambio para siempre—. Lo que vuelve cambiado tira además el perfil
  derivado de ese usuario, porque los pesos de género salen de las puntuaciones
  y ya no valen.

- **No contestar `ok` antes de que el cambio esté en la base.** `escribir()`
  encola y vuelve enseguida; el `200` salía con la escritura todavía en vuelo.
  Con una instancia daba igual, porque el que preguntaba era el mismo proceso.
  Con dos, ese `ok` es justamente la señal de que el otro lado puede ir a leer:
  puntuabas en el celular, recargabas la compu al toque y no estaba. Ahora la
  respuesta espera a que aterrice. En una lectura no cuesta nada, porque no hay
  nada encolado.

Un borrado no deja fila, así que no hay nada que traer y el perfil borrado
sobrevivía del otro lado. Por eso hay una tabla de **lápidas**: se anota qué
clave se fue y cuándo. Altas y bajas se leen juntas y ordenadas por fecha, para
que borrar y volver a crear termine como corresponde y no al revés.

#### La fila que se perdía para siempre

La primera versión de esto tenía un agujero, y no era teórico: **`now()` en
Postgres es la hora en que arrancó la transacción, no la del commit.**

    A escribe con fecha           19:49:36.685    (transacción todavía abierta)
    B toma su marca               19:49:36.849    (no ve nada: A no commiteó)
    A commitea                    19:49:36.9xx
    B pregunta "¿qué hay después de 19:49:36.849?"  ->  nada

La fila de A quedaba con una fecha **anterior** a la marca de B, así que no
volvía a aparecer nunca: puntuabas en el celular y en la compu no estaba hasta
reiniciar. Verificado contra un Postgres de verdad, no deducido leyendo.

El arreglo es mirar **diez segundos hacia atrás** además de lo posterior a la
marca, que es muchísimo más que lo que tarda un `INSERT`. Eso hace que las
mismas filas caigan en varias pasadas seguidas, así que la consulta se parte en
dos: primero claves y fechas —sin contenido—, y sólo se piden los valores de lo
que de verdad cambió. Sin eso, cada refresco mandaba `puntuaciones.json` entero
por la red de nuevo.

La fecha se compara como **texto de la base** y no como `Date`: el driver
redondea a milisegundos, y dos escrituras dentro del mismo milisegundo se veían
iguales.

`test-almacen.mjs` reproduce el caso con una transacción abierta a mano y falla
si se saca la ventana.

#### Lo que se escribe entero se pisa entero

Refrescar arregla *enterarse*. No arregla *escribir*: `escribir()` manda el
documento completo y sin condiciones, así que el último que llega gana y el
cambio del otro desaparece sin error.

Para una puntuación eso es un empate perdido y nada más. Para **`cuentas.json`
es otra cosa**, porque ahí viven TODAS las cuentas en una sola fila y cada
cambio la reescribe entera: cambiar la contraseña, guardar una API key, o
«cerrar sesión en todos lados». Si una instancia la reescribe desde una lectura
vieja, revierte lo que hizo la otra — y **volver atrás un cierre de sesión es
desactivar una medida de seguridad en silencio**: la cookie que se quería matar
sigue viva. Lo mismo con `invitaciones.json`: una invitación dada de baja que
vuelve a servir es la única puerta de entrada a la app abriéndose sola. Y los
usos de una invitación son un contador, que es el caso de manual.

La ventana no es teórica: guardar una API key hace una ida y vuelta a TMDB
*entre* la lectura y la escritura, o sea cientos de milisegundos con la copia
vieja en la mano.

Para esos documentos ya no se manda un valor sino una **función**, y se aplica
sobre lo que hay en la base en ese momento. El `UPDATE` va condicionado a la
fecha que se leyó; si no engancha, es que alguien escribió en el medio y se
reintenta sobre lo nuevo. El número de versión de sesión se sube sobre **el de
la base**, no sobre el que se leyó — sumarle uno a un número viejo da uno que
ya se usó, y las cookies que había que invalidar siguen valiendo.

La interfaz sigue siendo sincrónica: devuelve enseguida el valor optimista para
poder contestar el request, y la confirmación viaja por la cola de escritura.

Los perfiles se arreglan por el mismo camino y de paso cierran un agujero: el id
(`papa`) es la clave del almacén y se elegía contra la lista de este proceso,
que puede estar vieja. Dos cuentas creando un «Papá» a la vez terminaban
**compartiendo las puntuaciones**. Ahora, si el id ya está tomado en la base, la
entrada no se agrega: sin entrada, `usuarioDe()` no le autoriza ese perfil a esa
cuenta. Queda un perfil que no se creó —se reintenta con otro nombre— en vez de
dos personas escribiendo encima de la misma lista.

**Lo que queda sin cubrir, dicho claro:** las puntuaciones y el estado de cada
perfil siguen escribiéndose enteros. Si puntuás *la misma* película desde las
dos pantallas en la misma fracción de segundo, gana la última. Es un empate que
para una persona sola no existe, y llevarlo al esquema de arriba costaba
reescribir todos los caminos de guardado a cambio de nada.

Lo prueban `test-almacen.mjs` (20 chequeos sobre el almacén, incluida la
escritura simultánea de dos instancias sobre `cuentas.json`) y
`test-dos-instancias.mjs` (16, con dos servers de verdad contra la misma base).
Los dos fallan si se sacan los arreglos: está verificado, no supuesto.

### Variables de entorno

| | |
|---|---|
| `DATABASE_URL` | Postgres. Su sola presencia prende el modo publicado con cuentas. |
| `SESSION_SECRET` | Firma las sesiones y cifra las API keys. 32+ caracteres. **Si cambia, se cae cada sesión y ninguna key guardada se puede volver a leer.** |
| `TMDB_API_KEY` | Solo para correrlo local sin cargar la key desde la web. |
| `PORT` | Por defecto 5173. Render lo pone solo. |
| `HOST` | Dónde escucha. Por defecto `127.0.0.1` — sólo tu compu. Render necesita `0.0.0.0` y lo tiene puesto en `render.yaml`; si la variable no llegara, el server igual lo detecta por `RENDER_EXTERNAL_URL` y no se cae. |
| `REQUERIR_LOGIN=1` | Fuerza el modo con cuentas sin base, para probarlo en tu compu. |
| `MANTENER_DESPIERTO` | Rango horario en el que la app no se deja dormir, ej. `9-1`. |
| `MEDIR=1` | Escribe en el log cuánto tarda cada tramo de una búsqueda. |
| `ADMIN_EMAILS` | Quién puede generar invitaciones, separado por comas. Sin esto, el dueño es la primera cuenta que se creó. |
| `REGISTRO_PERMITIDO` | Mails que pueden registrarse sin código. La escotilla para no quedarte afuera de tu propia app. |

## Los archivos que podés tocar

Todo vive en `data/usuarios/<perfil>/`.

### `preferencias.json`
Reglas que las puntuaciones no enseñan solas. Se releen en cada búsqueda: editás y
recargás la página.

| | |
|---|---|
| `anioMinimo` + `notaMinimaViejas` | Lo anterior a ese año solo aparece si llega a esa nota. |
| `notaMinima` + `votosMinimos` | Piso de calidad para todo. |
| `confianzaMinima` | La vara. Debajo de esto no se muestra nada, aunque la lista quede corta. |
| `seriesTerminadas` | Las que siguen al aire pierden puntos. |
| `maxEpisodios` | Arriba de 60 empieza a restar, cada vez más. |
| `bonusCapituloCorto` | Capítulos de 35 min o menos suman. |
| `evitarKeywords` | `time loop`, `amnesia`… No incluye giros finales, que sí te gustan. |

| `penalizarMotivos` | Cuánto bajar lo que se parece a las que marcaste con un motivo. |
| `penalizarEfectosViejos` | Ciencia ficción y fantasía anteriores a `anioMinimo`: los efectos son lo que peor envejece. |
| `penalizarFamilia` | Género Familia en imagen real: el mismo cluster de infancia que Disney, pero la regla de animación no lo toca. |
| `penalizarSoloHablada` | Drama/romance/historia/documental sin ningún género de movimiento. Regla declarada, no aprendida: sobre sus notas la señal es cero. 0 lo apaga. |
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
| `almacen.mjs` | dónde viven los datos: archivos o Postgres, misma interfaz |
| `auth.mjs` | cuentas, sesiones firmadas y la API key de cada uno |
| `subir-mis-datos.mjs` | manda tus puntuaciones de acá a la app publicada |
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
