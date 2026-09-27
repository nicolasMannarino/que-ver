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
- **La dejé** → la misma caja, pero la nota es de lo que llegaste a ver y queda con
  el motivo «la dejé», como en la pestaña Puntuar. Si la empezaste por la
  recomendación cuenta para el marcador: dejarla es un error de la app.
- **Estoy viendo** (solo series) → no te la vuelve a ofrecer y la anota en Mis
  gustos → «Estoy viendo ahora». Cuando la puntúes sale de esa lista sola. No cuenta
  para el marcador: ya la estabas mirando.
- **No me interesa** → nunca más, y le enseña al perfil que eso no tienta.
- **Me la guardo** → a la lista de pendientes, y le enseña que eso sí tienta
  (ver «Lo que te tienta enseña»).

**Mis puntuaciones.** Todo lo que puntuaste, con póster, título linkeado a IMDb, tu nota y la de TMDB al lado
(para comparar), y con buscador y filtros por tipo
(películas / series / todo), por rango de puntaje y por orden. Desde ahí cambiás
notas, quitás títulos, y con **+ Agregar** buscás cualquier película o serie y la
puntuás aunque no estuviera en tu lista original.

**Descargar .txt / .csv** exporta tus puntuaciones. El `.txt` sale en el mismo
formato de bloc de notas (`10 Puntos: A, B, C`), así que lo podés usar en
cualquier otro lado — o volver a importarlo acá.

## Cómo se ve

Una **grilla de pósters**, no una lista de fichas. Antes cada recomendación era una
tarjeta horizontal de 340px con el póster de 116px a la izquierda y todo el texto al
lado —título, año, duración, géneros, nota de TMDB, confianza, motivo, resumen y cinco
botones—, y con seis en pantalla no se distinguía una de otra. Él, comparando con
taste.io: *"es fea visualmente"*.

Ahora la imagen **es** la tarjeta: seis por fila en la compu, dos en el celular, con el
título y el año abajo y los dos porcentajes arriba a la derecha. Todo lo demás —el motivo, el
resumen, los botones— vive **encima del póster** y aparece al pasar por arriba; en el
celular, tocando el póster, que es donde no hay hover.

Y el panel de arriba se pliega. Tenía título, ayuda, texto libre, siete presets, doce
géneros, tres casillas y la duración, todo desplegado: media pantalla antes de la
primera recomendación. Él: *"es muy grande eso de «qué tenés ganas de ver», está como
desproporcionado"*. Quedaron a la vista el texto, los presets y el botón; el resto está
atrás de **«Más filtros»**, que ya existía pero solamente en el celular.

El nombre dejó de ser texto pelado: el encabezado lleva el mismo dibujo que el ícono
de la app —pantalla y play— y el acento parte el nombre en dos. Y la barra de scroll
de la ficha, que en Windows salía como un bloque gris con riel claro pegado al borde de
una tarjeta de 196px, es fina, sin riel y del color del acento.

Nada de esto cuesta velocidad: no hay una fuente externa, ni una imagen nueva, ni un
pedido más. Sigue siendo un solo `index.html` sin build.


## Mis gustos

La tercera pestaña. Es lo que el motor aplica **además** de tus puntuaciones: tus notas
le enseñan qué te gusta, estas reglas le dicen qué no mostrarte. Se edita desde la app
y se guarda en `preferencias.json`.

- **Películas viejas**: las anteriores a `anioMinimo` no restan puntos, directamente
  **no aparecen** si no llegan a `notaMinimaViejas`. Es una vara, no un descuento.
- **Calidad mínima**: piso general de nota y de votos para cualquier recomendación.
  Sin esto la lista arranca bien y se cae a pique en el puesto 5.
- **Series**: bajar las que siguen al aire, y penalizar arriba de N capítulos. Arriba
  de 100, directamente no aparecen salvo que el capítulo sea corto y la serie muy buena.
- **Musicales**: bajan, no desaparecen. Por la keyword «musical», no por el género Música.
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

    AUC 0.776    0.50 = una moneda · 0.70 = útil · 0.80+ = bueno
    Spearman 0.446

Traducido: si agarrás una que te gustó y una que no, el motor las ordena bien 3 de
cada 4 veces. Útil, no mágico.

**Estuvo mudo un tiempo.** Leía la key con `leer(DATA + "/config.json")`, pero
"config.json" es la *clave* del almacén y `leer` ya la resuelve contra `data/`:
quedaba `data/C:/.../data/config.json`, que no existe. Sin key, `fichas()`
devolvía cero títulos y el backtest imprimía **NaN** en las cuatro métricas sin
decir por qué. Los números de acá arriba son de después de arreglarlo.

La mezcla de la fórmula de afinidad (mitad rasgos sueltos, mitad "a cuáles de las
tuyas se parece") se eligió corriendo esto, no a ojo: pasó de 0.724 a 0.742.
Sumarle la nota de TMDB la llevó de 0.750 a 0.776 (ver «Tus 43 series»).

### Contra el catálogo, no contra tu propia lista

El backtest de arriba ordena **tus** títulos. Son cosas que vos elegiste ver: ya pasaron
tu filtro, y el 64% te gustó. El pool de verdad es el catálogo, donde casi nada te va a
encantar. Por eso decía P@10 90% mientras él, mirando seis tarjetas: *"quizás me gusta 1
o 2"*.

Ahora le suma **negativos muestreados**: títulos conocidos que no puntuaste, sorteados de
páginas al azar del catálogo por votos — no las 100 más votadas de la historia, que son
todas buenas y conocidas y no son el catálogo, son otra lista de favoritas. No sabemos
que no te gustarían, alguno sí, así que la precisión de ese pool es una **cota de abajo**.
Lo que sí mide honesto es el orden.

    AUC de tus 9-10 contra...
       tus propias 1-6:          0.884
       el catálogo que no viste: 0.883

**La sospecha no se sostuvo:** el orden aguanta igual contra títulos que nunca elegiste,
y eso que las tuyas van con la predicción sin su propia nota y las del catálogo no tienen
nota que sacar. El sesgo de selección no era el problema. El problema está en la
composición:

    De las primeras que mostraría:
       top 10:  3 tuyas 9-10 · 4 tuyas 7-8 · 1 tuya 1-6 ·  2 del catálogo
       top 30:  7 tuyas 9-10 · 5 tuyas 7-8 · 2 tuyas 1-6 · 16 del catálogo

    Las 10 del catálogo que pondría primeras:
       KENGAN ASHURA · SPY×FAMILY · La leyenda de Korra · TONIKAWA ·
       Spider-Man: Un nuevo universo · Justicia Joven · Cómo entrenar a tu dragón 3 ·
       Roma · Spirit · Grandes Héroes

**Nueve de diez son animadas.** Ahí está el "de 6 me gustan 1 o 2": no es que el orden
esté mal, es que recomienda **un solo rincón**. Tus 9-10 están concentradas en anime, el
perfil lo amplifica, y cuando se acaba el anime bueno lo que sigue es Tonikawa. Encaja
con `penalizarInfantil: 0` y `penalizarAnimacionOccidental: 0`: sin esos frenos, el
catálogo animado se lleva la lista.

    NEGATIVOS=0 node backtest.mjs      para saltearlo
    NEGATIVOS=600 node backtest.mjs    para apretar más

El sorteo es el mismo en cada corrida, a propósito: si el pool cambia, dos medidas no se
pueden comparar.

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

Propone títulos conocidos que todavía no puntuaste, ordenados por **la probabilidad de
que los hayas visto**: los que más se parecen a lo que ya mirás.

**Probé lo contrario y salió mal.** La primera versión ordenaba por *cuánto le enseñan al
motor* — muestreo activo, de manual: preguntar por aquello de lo que el perfil no sabe de
qué lado cae. En la cancha, de 24 tarjetas pudo puntuar **2**. La razón se ve mirándola de
atrás: lo que el motor no entiende es justamente lo que él no mira. Le salían El
resplandor, Dunkerque y ¡Huye!, ninguna vista; con afinidad salen Dragon Ball, One Punch
Man, La Oficina y Malcolm, que son de su mundo.

Sí, cada respuesta del borde enseña más que una del centro. Una respuesta que no llega
enseña cero.

**No se puede medir offline cuál conviene.** La clase "la vio" son sus puntuadas, y ésas
en pantalla se filtran siempre: cualquier número que salga de ahí habla de títulos que
nunca se muestran. La primera medición daba 21 contra 10 a favor de la afinidad y estaba
inflada por construcción. Lo decide él usándolo.

Cuánto sabe el motor de un título se calcula con los tres campos que `/discover` ya trae
—género, década e idioma— y no cuesta ninguna consulta de más: pedir las 120 fichas
enteras para ordenar 24 tarjetas serían cien consultas por pantalla (`rasgosLivianos` y
`opinionLiviana`, en motor.mjs).

Hay un tope por tipo: de las películas más vistas ya puntuó casi todas y de las series
no —43 contra 243—, así que sin tope el pool queda lleno de series y la pantalla salía
20 a 4.

**Para él, el lado de las películas está casi agotado**, y eso no lo arregla ningún orden:
de las 600 películas más votadas ya tocó 327 (192 puntuadas, 135 salteadas), y las 273
que quedan son las que no miró. Con las series sobra: 516 sin tocar de 600.

Salidas por título:

- **tres botones: "me encantó" (9), "me gustó" (7), "no me gustó" (4)**. Es lo que hace
  taste.io, y es por lo que ahí se cargan cien títulos en el rato que acá llevaban
  veinte: la nota exacta importa poco —el motor trabaja con cuánto se despega de tu
  promedio, no con el número— y la fricción de elegir entre diez importa mucho.
  Sus 286 tienen **12 notas de 4 o menos**: calificó lo que él eligió ver, así que casi
  no hay "no". Un motor que nunca vio un rechazo no aprende a rechazar, y el botón está
  para eso.
- **la nota del 1 al 10**, abajo, para lo que quieras matizar.
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

## Probarlo con lo que ya puntuaste

Un recomendador nunca te muestra lo que ya viste, así que no tenés con qué comparar.
Probando taste.io, lo que lo convenció fue justo eso: *"me recomendó cosas que ya vi y
que me gustaron, así que bien"*.

El botón **"Probar con mis puntuaciones"**, abajo de la pestaña Puntuar, ordena tus
propias notas con el mismo motor —cada título calculado **sin su propia nota**— y muestra
al lado qué le pusiste. Es `backtest.mjs`, sin terminal:

    de las 20 que pondría primeras, 16 las puntuaste 8 o más
    eligiendo vos: 37% de tus 259

Si arriba están tus 9 y tus 10, anda. Si aparece un 5 en el puesto 3, no. El número de al
lado es el mismo porcentaje que muestran las tarjetas, así que también sirve para ver si
ese porcentaje miente.

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

### El techo del 53%, y por qué no se sube

Él, mirando la grilla: *"las que más tienen son 53%, me parece poco la verdad teniendo
en cuenta la cantidad de puntuaciones que puntué"*. Sonaba a queja sobre el motor y era
sobre la curva.

El bloque de arriba de la curva de 8+ da **66%**, y ése es el techo absoluto: ninguna
tarjeta puede mostrar más, aunque la película puntúe 1.72 de confianza contra el 0.55
del corte. Y se satura: todo lo que pasa 0.55 muestra el mismo 66%, así que la #1 se ve
igual que la #40.

La tentación es aflojar `minBloque` y `prior` hasta que el techo suba. Medido con
validación cruzada de cinco pliegues sobre sus 286 notas —la curva se arma con cuatro
quintos y se comprueba contra el quinto que no vio—, eso es mentir:

| minBloque / prior | techo | 60-75%: promete → pasa | 75%+: promete → pasa |
|---|---|---|---|
| **20 / 8 (el de hoy)** | 66% | 64% → **47%** | — |
| 12 / 4 | 79% | 69% → 38% | 78% → **45%** |
| 6 / 2 | 85% | 69% → 50% | 81% → **41%** |

El techo de hoy ya promete de más: arriba de todo dice 64% y cumple 47%. El banner de
la pantalla lo venía diciendo solo —*"de las que te recomendé con 70% o más: 2 de 4 te
gustaron. Yo te había prometido 81%"*—. Subirlo era repetir ese error más fuerte.

La curva de **7 o más** no tiene ese problema en el promedio: llega a 88% y cumple
—promete 83%, pasa 76%—. Durante un tiempo la tarjeta mostró **las dos**, el 7+ grande y
el 8+ chiquito abajo.

**Eso se cayó.** Primero porque la pregunta que generaba era «¿qué representan los dos
números?»: dos porcentajes sin unidad en la esquina de un póster no se leen, se adivinan.
Y segundo, y peor, porque **arriba de todo los dos se saturan**. Una tanda real de diez,
medida contra sus notas:

```
8+  66%   7+  88%   conf 1.73   Demon Slayer
8+  66%   7+  88%   conf 1.65   Inuyasha
...
8+  66%   7+  88%   conf 0.88   Zootopia
```

Diez tarjetas, el mismo número en todas, y el puntaje interno yendo de 1.73 a 0.88. Un
número que es igual en la primera y en la décima no ordena nada y encima promete una
precisión que no tiene.

El segundo intento fue **el puesto** —#1, #2, #3—: exacto, imposible de saturar, y hace
visible que la lista está ordenada. Duró una versión. Ordenaba, pero no decía si la
primera era buena, y la respuesta fue: *"se supone que la película número 1 me tiene que
gustar SÍ O SÍ"*.

El tercero, el que quedó: **la nota que creo que le vas a poner**. De las que el motor
puntúa parecido a ésta, ¿qué nota les pusiste vos? Está en la escala que él mismo usa,
se lee sin explicación, y deja claro de entrada que nadie le está prometiendo un 10 —
porque con 286 notas no se puede. El puesto no se perdió: bajó al pie de la tarjeta,
al lado del año. Los dos porcentajes siguen en el globito y en la ficha.

### Y el tope se lo estaba comiendo la curva

Arriba de 0.55 de confianza el motor «no distinguía»... pero eso era en parte un
artefacto de cómo se armaba la curva. `calibrar()` corría la isotónica sobre puntos
sueltos y **después** fusionaba los bloques flacos, y esa fusión se tragaba la punta:
sobre sus 259 puntuaciones el bloque de arriba terminaba arrancando en 0.55 con 54
títulos adentro.

Y era falso. Mirando sus notas directamente:

```
conf > -inf   n=259   nota 7.04   8+ 37%   9+ 13%
conf >  0.30  n= 78   nota 7.86   8+ 63%   9+ 29%
conf >  0.55  n= 55   nota 7.87   8+ 64%   9+ 29%
conf >  0.80  n= 25   nota 8.28   8+ 80%   9+ 36%

sus 20 mejor predichas, nota real: 8 9 9 8 9 10 9 8 7 8 8 8 8 10 9 10 8 8 10 8
                                   media 8.60 · 9 de 20 se llevaron 9 o más
```

De sus 20 mejor predichas, **una sola** bajó de 8. Eso es una señal real y la curva la
estaba promediando contra el tramo de abajo.

El arreglo es dar vuelta el orden: **agrupar primero** de a `minBloque` puntuadas y
correr la isotónica sobre esos bloques. Cada bloque nace con suficientes observaciones y
la isotónica solo junta los que de verdad se contradicen. El resultado sobre sus datos:

```
antes:  ... 0.55 -> 7.94 (n=54)                 <- toda la primera pantalla igual
ahora:  ... 0.38 -> 7.65 (n=60)   0.92 -> 8.16 (n=19)
```

**Lo que sigue siendo cierto:** arriba de 0.92 el motor no distingue una de otra. Cuando
las doce que se muestran caen todas en ese tramo, la pantalla lo dice en una línea en vez
de inventar decimales — el orden ahí sale del puntaje interno, pero la diferencia entre la
#1 y la #12 no se sostiene con 286 notas. Eso se arregla puntuando más, no con aritmética.

### La tabla cortaba lo viejo más fuerte que todos

Con «Sin animación» puesto, lo mejor que le ofrecía la app daba **0.735** de confianza
—sus propias favoritas están entre 1.0 y 1.9—. No había nada en el pozo que se pareciera
a su gusto tanto como lo que ya amaba, y de ahí la sensación de *"ninguna que crea que
puede ser una GRAAAN recomendación"*.

La tabla sí las conocía. `candidatosVecinas()` cortaba en `prefs.anioMinimo` **antes de
proponer**, y eso la dejaba cortando más fuerte que todas las demás fuentes: para el
resto, «anterior al 2000» no es una pared sino un castigo (`penalizacionPreAnio`) más
una vara de calidad (`notaMinimaViejas: 8`), y lo viejo que quedó como clásico pasa
igual. Acá nunca llegaba a que `filtrar()` decidiera.

Lo que se perdía, con el castigo por vieja **ya aplicado**:

| | antes | ahora |
|---|---|---|
| 1ª | Harry Brown 0.735 | **Harakiri 1.260** |
| 2ª | El jardinero fiel 0.701 | **Los siete samuráis 1.166** |
| 3ª | Senna 0.603 | Vivir 0.774 |
| 4ª | 3 Idiotas 0.594 | Cinema Paradiso 0.567 |

Ahora corta sólo cuando lo viejo está prohibido de verdad: el tilde **«Nada anterior al
2000»**, que es lo que `soloNuevas` significa. Sin el tilde decide `filtrar()`, como con
cualquier otra candidata. Si aparece demasiado cine viejo, el tilde está para eso.

## Lo ya mostrado vuelve

"Ya te lo mostré" vale para **la búsqueda actual**, no para siempre. Antes se
acumulaba sin límite: a las 63 el pozo se secaba, y algo que le había interesado y
no marcó desaparecía sin manera de volver a encontrarlo. Apretar "Dame algo para
ver" pone todo en juego otra vez; "mostrame otras" sigue bajando sin repetir.

Lo que **sí** desaparece para siempre es lo que puntuó, lo que marcó como visto, lo
que descartó con "No me interesa" y lo que se guardó.

## Mis guardadas

Botón arriba de Recomendar. Sin esto, "Me la guardo" no llevaba a ningún lado.

Lo guardado ya no vuelve a aparecer en Recomendar: está acá. Además, desde que
guardar le enseña al perfil (abajo), una guardada se parecía a sí misma y volvía con
más confianza de la que tiene: Una mente brillante saltaba de 74% a 83%.

## «La dejé» es floja

Lo que él pide, dicho así: *"que no me hagan sacarla en la mitad"*. Y «la dejé» era
solo una etiqueta: The Boys, Black Mirror y The Umbrella Academy, las tres dejadas con
7, contaban como que le gustaron y como aciertos 7+ en la curva. El 7 era de lo que
llegó a ver; el dato que importa es que no la terminó.

Ahora una dejada pesa como **5 como mucho** (`comoGusto()` en motor.mjs) en el perfil,
la tabla de vecinas y la curva, y en el marcador no cuenta como acierto. Su nota queda
como la puso: la lista y «Probar con mis puntuaciones» muestran la de él.

Medido con backtest.mjs sobre sus 286, casi no se mueve, y es lo esperable con 7
títulos: la mediana de sus 9-10 contra el catálogo pasa del puesto 71 al 66, y 38
candidatas pasan su vara en vez de 44. El AUC «sus 9-10 contra sus 1-6» baja un poco
(0.810 → 0.798) porque ahora hay flojas que se parecen a lo que le gusta, que es justo
el caso difícil que antes no se medía.

## Lo que te tienta enseña

Él, mirando 6 recomendadas: *"quizás me gusta 1 o 2"* — La Liga de la Justicia y Una
mente brillante, *"aunque esta se me hace que es bastante lenta"*; Forrest Gump o La
sociedad de los poetas muertos, *"capaz, pero son MUUUY viejas"*. Lo que lo frena, el
ritmo y la época, no está en ninguna ficha ni en MovieLens. Está en su reacción al ver
la tarjeta, y esa reacción se tiraba: «No me interesa» solo sacaba la tarjeta, y en
toda la historia de la app lo había usado una vez.

Ahora **«Me la guardo» y «No me interesa» le enseñan al perfil.** Cada toque pesa como
una nota medio desvío arriba o abajo de su promedio, sobre los rasgos —género, década,
keywords— y sobre los vecinos. No mueve su media, no siembra y no calibra: el
porcentaje de la tarjeta sigue saliendo solo de sus notas. Lo que ya puntuó no cuenta
como reacción, y si la guardó y después la descartó, manda lo último. El perfil se
rearma en la próxima búsqueda; la lista que está recorriendo no se reordena.

Sirve igual para alguien con 15 puntuaciones: tocar veinte tarjetas es más fácil que
puntuar veinte películas.

**Lo que no se sabe todavía, dicho claro:** el peso de un toque está puesto a ojo. No
hay con qué medirlo, porque hasta ahora las reacciones no se guardaban como señal.
Con sus 4 de ejemplo la lista casi no cambia —salen El último samurái y Camino
salvaje—; se va a notar con varias docenas. Cuando las haya, se mide como lo demás:
si lo que le tentó, y después vio, le gustó más que el resto.

### La grilla «¿Te tienta?»

El mecanismo existía y estaba vacío: dos toques en toda la historia de la app. El
problema no era el peso, era la fricción — una reacción por tarjeta, leyendo.

La pestaña Puntuar tiene ahora una segunda grilla con las mismas candidatas de
Recomendar, en chico, con tres botones: **me tienta · no me tienta · ya la vi**. No hay
endpoint nuevo: pide `/api/recomendaciones` sin `nueva`, así que avanza la misma cola que
«Mostrame otras», y los botones son los mismos de la tarjeta (`/api/feedback`).

**Por qué hace falta**, con sus números: de sus 286 puntuaciones, **12 son de 4 o menos**.
Calificó lo que él eligió ver, así que casi no hay "no". Un motor que nunca vio un
rechazo no aprende a rechazar — y eso es exactamente lo que el pool realista dejó a la
vista, con 9 de las 10 primeras del catálogo animadas.

Y es la única entrada que **no se agota**. De las 600 películas más votadas ya tocó 327:
de lo que vio y no puntuó queda poco. De candidatas que no vio hay catálogo entero, y
acá no hace falta haberlas visto para contestar.


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

## «Serie» no mostraba nada

Él: *"no puede ser que teniendo puntuadas tantas series no me aparezcan opciones
para ver"*. Tenía razón, y eran tres cosas.

**La vara de votos era de películas.** `votosMinimos` en 5000 quiere decir "solo
cosas conocidas", pero en TMDB una serie igual de conocida tiene muchos menos
votos. Con 5000 pasan 1061 películas y **69 series**, de las cuales él ya vio la
mitad. De 389 series candidatas, 360 morían ahí y quedaban 4.

Ahora la vara se traduce por **posición en el catálogo**: el piso de series que
deja pasar tantos títulos como ese piso deja pasar en películas. Medido contra
TMDB en septiembre de 2026:

| películas con ≥ | cuántas | series con ≥ | factor |
|---|---|---|---|
| 150 | 17.953 | 11 | 0.07 |
| 1000 | 4.983 | 82 | 0.08 |
| 5000 | 1.061 | 547 | 0.11 |
| 10000 | 387 | 1403 | 0.14 |

No es un factor fijo, así que `pisoVotos()` interpola en esa tabla. Si el catálogo
cambia mucho, se vuelve a medir.

**Sus películas no opinaban.** Pidiendo «Serie», las semillas eran solo sus 11
series —casi todas anime— porque los `recommendations` de una película devuelven
películas. Sus 32 películas favoritas no aportaban nada, y sus gustos de cine y de
series son casi los mismos. Ahora van primero las semillas del tipo pedido y detrás
las del otro, que entran por un **puente de keywords**: las keywords de esa película
que más pesan en su perfil, buscadas entre las series. Las keywords de TMDB son las
mismas para cine y TV. La tarjeta lo dice: *"Porque te gustó Batman: El caballero
de la noche y El hombre araña 2"*. Con «Película» funciona igual, al revés.

**Los géneros hablaban dos idiomas.** TMDB numera distinto los de TV: "Action &
Adventure" es 10759, no Acción (28) y Aventura (12). Lo que aprendía de sus
películas de acción no le decía nada de una serie de acción. Ahora el perfil
traduce todo a un solo idioma, y al pedirle series a TMDB se traduce de vuelta —
antes le pedía a `/discover/tv` "Aventura|Fantasía" con ids de cine, que ahí no
existen. Para excluir no se traduce: vetar Aventura se llevaría toda la acción.
El backtest no se mueve (AUC 0.751 → 0.750).

Con sus datos, pidiendo «Serie»:

| | antes | ahora |
|---|---|---|
| pasan la vara | 4 | 69 |
| con «Sin animación» | las 4 eran anime | 40, 31 traídas por alguna película suya |

**Lo que no cambió, dicho claro:** sin filtros, las primeras siguen siendo anime,
porque ahí está su 8+ más alto. Para series de imagen real, «Sin animación» ahora
sí tiene con qué: Merlín, Sandman, Firefly, Titanes, His Dark Materials.

## Tus 43 series, y por qué igual salían raras

Él, después de lo de arriba: *"fijate que tengo 43 series puntuadas"* y *"no me
convencen mucho las recomendaciones de las series, son medias raras"*.

**Solo 11 de sus 43 series sembraban.** 19 están arriba de su media; 2 son «de
chico» y quedan afuera a propósito. Las otras 6 las tapaba el cupo de 5 semillas
por género, que era **compartido con las películas**: sus películas de drama
llenaban los 5 lugares, y Chernobyl, Peaky Blinders, Dr. House, Gambito de dama y
Se presume inocente no sembraban nunca. Ahora el cupo es por género y por tipo: de
11 series semilla a 16.

**El motor no entendía sus series de imagen real.** Medido leave-one-out, le habría
dado -0.17 a Breaking Bad (su 10), -0.50 a Chernobyl y -0.67 a Peaky Blinders (sus
8): esas series no se parecen al anime, que domina el perfil. Sumar la nota de
TMDB —centrada en la nota media de lo que él vio, para que la vara siga
significando lo mismo— lo mejora en todos lados:

| peso de la nota | AUC todo | películas | series |
|---|---|---|---|
| 0 (antes) | 0.730 | 0.720 | 0.723 |
| **0.5** | **0.772** | **0.757** | **0.757** |
| 0.7 | 0.767 | 0.749 | 0.778 |

Estos AUC dejan afuera lo marcado «no tener en cuenta»; `backtest.mjs` lo incluye y
da 0.750 → 0.776, Spearman 0.399 → 0.446. 0.7 le sube más a las series pero les baja
a las películas, y con 43 series esa diferencia es ruido. Sumar también los votos
casi no agrega y corre la escala.

**«Porque te gustó» mentía en el puente.** *"Uzaki-chan, porque te gustó En busca de
la felicidad"*: compartían una keyword suelta. Ahora una semilla que vino por el
puente solo se nombra si se parece de verdad: **al menos 2 keywords o personas en
común**. Si no, la tarjeta dice qué rasgos suyos tiene.

El primer intento fue Jaccard ≥ 0.04, "unos 3 rasgos en común", y no alcanzaba:
contaba igual el género, la década y el idioma, que comparte medio catálogo.
*"Sherlock, porque te gustó Siempre a tu lado: Hachiko"* eran drama + «friendship»
+ inglés; *"Outer Banks, porque te gustó Hombres de honor"*, «diving» + inglés.

**Lo que sigue sin resolver, dicho claro:** sin filtros, «Serie» es casi todo anime
al 88%, y ahí adentro el motor no distingue Jujutsu Kaisen de High School DxD: para
él las dos son «anime, based on manga, shounen». Eso no lo arregla un peso; hace
falta que él diga qué no quiere.

## IMDb también en las series

TMDB le pone el id de IMDb a la ficha de una película, pero a la de una serie no:
vive en `/tv/{id}/external_ids`. Por eso las tarjetas de series linkeaban a TMDB.
Se pide solo para lo que se muestra y para la biblioteca —el resto de la cola, de
fondo— y queda cacheado también en la base: un id de IMDb no cambia. De 0 de 8
tarjetas de series con IMDb a 8 de 8; en la biblioteca, 286 de 286. La primera vez
que se abre la biblioteca tarda un segundo más, por las 43 series.

## Varios segundos por búsqueda

Él: *"se demora varios segundos para traer las recomendaciones, ya sea de películas,
series o cuando pongo para que me traiga más"*. Medido en una copia aislada con sus
datos y el cache de discover vacío, que es como queda Render después de cada
reinicio:

| | antes | ahora |
|---|---|---|
| buscar (todo) | 6.8 s | 1.7 s |
| buscar serie | 1.0 s | 0.7 a 1.2 s |
| buscar película | 0.7 s | 0.9 a 1.4 s |
| «otras», clics seguidos | hasta 5.8 s | hasta 0.7 s |
| «otras», leyendo 5 s entre clic y clic | hasta 5.8 s | 0.0 s |
| armar el perfil | 0.7 s | 0.1 s |

Serie y película no mejoran: ya eran de una sola ronda, y ahora siembran con más
títulos (16 series, 38 películas). La diferencia entre corridas es la red. Y todo
esto es en una compu de escritorio: en Render la CPU es de 3 a 8 veces más lenta,
que es justo donde más pesa lo del perfil.

- **Las páginas de TMDB se pedían de a una.** `candidatosPorPerfil` y
  `candidatosAmplios` esperaban cada página antes de pedir la siguiente: hasta 30
  idas y vueltas en fila. Ahora van todas a la vez y se agregan en el mismo orden,
  así que el resultado no cambia.
- **Calibrar rearmaba el perfil 286 veces**, con 286 conjuntos de rasgos nuevos
  cada vez: 612 ms. `afinidadesSinCadaUna()` guarda las sumas de cada rasgo una
  sola vez y a cada título le resta su parte: 64 ms, y da lo mismo hasta la
  decimal 15 (`test.mjs` lo compara contra el camino largo). Importa más de lo que
  parece: puntuar tira el perfil, así que esto se pagaba en la primera búsqueda
  después de **cada** nota.
- **El relleno de la cola arranca de fondo.** Cuando a la cola le queda menos de
  una tanda, se busca la siguiente mientras él mira estas ocho, en vez de esperar
  al clic. Pide lo que va debajo de lo que queda —el mismo tope de siempre—, y si
  una búsqueda nueva lo deja viejo, deja de cavar y no anota nada. Sin eso, buscar
  series después de un «otras» esperaba 4 segundos a un relleno que ya no servía.
- **Si el relleno de fondo ya buscó y trajo poco, el clic no vuelve a cavar**:
  sirve lo que hay. Era la misma excavación de 6 segundos dos veces seguidas.

De paso, dos cosas que el relleno de fondo volvía urgentes. `recomendar()` ya no
guarda la copia del estado que leyó al empezar: escribe sobre lo que hay en ese
momento (`anotar()`). En disco, leer devuelve una copia nueva cada vez, y guardar
la vieja se llevaba puesto un «No me interesa» que llegara en el medio. Y
`T.pool()` ya no se traga un error de key: una key mala no es "falló este título",
fallan todos, y tragárselo dejaba la búsqueda vacía sin decir por qué.

## La primera no se mueve

Él: *"me aparece una serie para ver primero y cuando pongo ver más esa serie como
que se va desplazada. La primera cosa que me recomienden no debería irse para abajo
nunca."*

Eran dos cosas a la vez:

- **La pantalla reordenaba la grilla entera** por confianza cada vez que llegaba una
  tanda. Si «otras» traía algo más alto, se metía arriba y empujaba todo. Ahora lo
  nuevo va siempre abajo, y lo que ya está en pantalla no se toca.
- **El server dejaba entrar algo mejor que lo ya mostrado.** Cuando la cola se
  vaciaba justo, el relleno buscaba "sin tope". Era así desde antes; con el relleno
  de fondo pasaba más seguido. Ahora el tope es lo último que se mostró, siempre.

Eso tenía un precio, y se midió: la lista se cortaba. Con «todo», a las 25 tarjetas
el relleno encontraba 35 con más confianza que lo último mostrado y ninguna por
debajo. Dos arreglos:

- **La primera búsqueda mira más hondo**: dos pasadas por el catálogo aunque las
  rondas de vecinos ya hayan juntado 24. Así las buenas entran en el orden desde el
  principio, en vez de aparecer después sin lugar donde ponerlas.
- ~~**Secciones.**~~ Si igual se acababa lo de abajo, la lista arrancaba una sección
  nueva donde el orden volvía a empezar. **Se sacó.** En pantalla eso se veía como
  un 70% atrás de dos 31%, y la respuesta fue textual: *«eso tiene que estar BIEN
  ordenado»*. Una lista con dos órdenes no es una lista ordenada, por más cartel que
  se le ponga en el medio. Ahora, si quedan mejores más hondo, salen primeras en la
  **próxima** búsqueda y el cartel de abajo lo dice.

**Y el que de verdad se veía en pantalla:** la cola se servía de a ocho, pero lo que
llegaba después —la búsqueda que dispara un chip de género, el relleno de fondo— se
pegaba al final con `concat`. Lo ya mostrado quedaba bien, pero **lo que todavía no se
había mostrado quedaba desordenado entre sí**: una traída por el filtro con 0.70 caía
atrás de dos que estaban en la cola con 0.31, y salían en ese orden en la tanda
siguiente. Dos arreglos, los dos en `recomendarEnOrden`:

- `sumarACola()` reordena **la parte no servida** cada vez que entra algo nuevo. Lo
  que está en pantalla no se toca nunca.
- La búsqueda que dispara un filtro ahora lleva **techo**, igual que el relleno: no
  puede meter nada por arriba de lo que ya se mostró. Si el filtro es nuevo no hay
  techo, porque ahí no hay nada mostrado y la lista empieza de cero.

`test-front.mjs` apila cuatro tandas con un género pedido y cinco sin filtro y controla
que el puntaje nunca vuelva a subir. Contra el código viejo, la primera falla.

Medido con el cache frío sobre sus datos, cinco «otras» seguidos por búsqueda: ni
una tarjeta supera a lo ya mostrado en su sección (el script de medición lo
controla una por una), y todas las tandas salen de 8. Con «Sin animación», «todo»
llega a 32 tarjetas y ahí sí se termina: no hay más que pasen su vara.

**El precio, dicho claro:** cliqueando «otras» sin leer, el clic que arranca una
sección espera al relleno: hasta 7 segundos. Leyendo las tarjetas, eso ya pasó de
fondo y tarda entre 0 y 1.3 s.

## «Solo si está muy buena»

Dos reglas que él pidió. Las dos son vara —si no la pasa, no aparece—, las dos son
para series de imagen real, y el anime queda afuera de las dos:

- *"No suelo mirar series en coreano, chino o japonés a menos que sea anime o que
  esté muy bueno."* Entre sus candidatas había 24 series asiáticas de imagen real,
  casi todas K-dramas, y 18 pasaban la vara. La nota no las separa: TMDB les da entre
  8.2 y 9.4 a todas, 8.5 a Scarlet Heart con 600 votos. Los votos sí. "Muy buena"
  es nota 8 y 2500 votos, estar entre las ~200 series más votadas de TMDB. Quedan
  Alice in Borderland, Estamos muertos y Goblin; se van las otras 21.
- *"Si la serie es bastante vieja y de ciencia ficción hay que ver si es buena."* De
  15 años o más, ciencia ficción o fantasía: nota 8.5 y 2500 votos. Empezó en 20
  años, 8 y 1800; abajo, por qué cambió.

Las películas no se tocan: Parásitos le gustó. Se editan en Mis gustos → «Las que
tienen que estar muy buenas».

## ¿Esto mejora puntuando más?

Pregunta textual: *"¿Si yo veo las primeras 3 o 4 películas y las puntúo va a mejorar? ¿O va
a ser así siempre?"*. Se mide: tomando N puntuaciones suyas al azar, diez repeticiones por N,
qué dice el tramo de arriba de la curva y cuánto ordena.

```
   N    techo   8+ arriba   AUC 9-10   n del tramo
  40     7.17       41%       0.746        40
  80     7.75       57%       0.759        23
 120     7.67       56%       0.723        36
 180     7.78       59%       0.751        36
 240     7.83       64%       0.766        30
 259     8.16       78%       0.761        19
```

**Sí mejora, pero no por donde uno cree.** La capacidad de ORDENAR es plana: el AUC se
queda en 0.75 desde las 40 puntuaciones. Lo que mejora es la RESOLUCIÓN: con más notas la
curva puede recortar un tramo de arriba más chico y más puro. Con 40 el tramo de arriba
eran las 40 y acertaba 41%; con 259 son 19 y acierta 78%.

O sea: puntuar más no hace que encuentre cosas mejores, hace que sepa **cuáles** de las que
encuentra son las buenas. Que es justo lo que él pedía.

### Y contra qué hay que comparar el número

```
sus notas:  1:1  2:2  3:1  4:8  5:18  6:56  7:77  8:63  9:15  10:18
media 7.04 · 8+ 38% · 9+ 13%
```

Un 7.2 en la esquina del póster parece una nota mediocre. No lo es: **es su promedio**.
Eligiendo a mano lo que mira —con tráiler, con recomendación de un amigo, con lo que sea—
él le pone 8 o más al 38%. El tramo de arriba de la app acierta 78%. Es el doble.

Por eso la pantalla ahora arranca diciendo la línea de base: sin ella, el número se compara
contra 10 y siempre pierde.

## Los vecinos no se pueden actualizar más

*"¿No se puede usar algo de vecinos pero más actualizado?"*. La tabla sale de MovieLens, y
mirando el catálogo de GroupLens: **32M (05/2024) es el más nuevo que hay**. Los «latest»
figuran actualizados en 9/2018, o sea más viejos, y el resto son 25M (12/2019), 20M
(10/2016), 10M (2009), 1M (2003), 100K (1998). No hay a dónde subir.

Lo que sí existe:

- **TMDB ya tapa el agujero de 2024 en adelante.** Las películas posteriores al corte de
  MovieLens no están en la tabla, pero sí en `/recommendations` y `/similar`, que son la
  otra fuente de candidatas y se actualizan solas. Por eso Solo Leveling (2024) o Jujutsu
  Kaisen 0 aparecen igual.
- **Trakt.tv** es la única fuente colaborativa de verdad actualizada y con API pública
  (la gente marca lo que ve todos los días). Cuesta: otro servicio externo, otra key, y el
  peso habría que medirlo con el mismo barrido que se le hizo a MovieLens. No está hecho.

Pero ojo con la premisa: el barrido de arriba dice que **el cuello de botella no es la
tabla**. El AUC es plano contra el tamaño de los datos. Más vecinos daría más candidatas
nuevas, no mejor orden.

## Variedad, sin romper el orden

Las doce primeras eran doce anime seguidos. No porque el motor se equivocara —cada una
es buena para él— sino porque su perfil está concentrado ahí, y una lista donde las doce
son la misma cosa no sirve para elegir qué ver hoy.

`diversificar()` ya existía y se aplicaba adentro de `recomendar()`... y después la cola
reordenaba todo por confianza y la deshacía entera.

No se puede diversificar la lista completa: la #9 terminaría con más puntaje que la #5 y
vuelve el problema de *«me aparece una con más porcentaje que varias de las que ya me
habías recomendado»*. Así que se baraja **dentro de cada tramo de la curva**. El tramo es
lo que se ve en la tarjeta: todas las de un tramo muestran la misma posible nota, porque
ahí el motor de verdad no las distingue. Barajarlas entre sí no rompe ningún orden que se
pueda percibir —el número sigue bajando tarjeta a tarjeta— y saca a las doce del mismo
rincón.

**Y hasta ahí llega.** Medido sobre su tramo de arriba:

```
tramo 8.2 — 21 títulos, 18 con Animación, 3 sin
tramo 7.5 —  7 títulos,  1 con Animación, 6 sin
```

El cupo mete las 3 que hay en los puestos 4, 5 y 8, y después no queda con qué: el tramo
es 18 de 21 anime. Eso ya no es un problema de orden, es que el puntaje está dominado por
su rincón más denso. Subir las del tramo 7.5 sería mentir sobre el número de la tarjeta.

## La frase del póster

*"Que al ver la película, la descripción y la foto ME DEN GANAS DE VERLA"*. El `overview`
de TMDB cuenta la trama y arranca siempre igual; el `tagline` es la frase del póster, la
que está escrita para engancharte. Va arriba del resumen, en la ficha.

El problema era de plomería: `tmdb.mjs` cachea una lista fija de campos —*"lo que no está,
no vuelve"*— y agregar uno obligaba a borrar el cache entero. En el hosting eso son tres
mil requests de golpe, en los dos backends, y hay que acordarse de hacerlo.

En vez de eso, el recorte lleva versión (`_v`). Lo cacheado con una versión vieja se
ignora y se vuelve a pedir **solo, de a una, a medida que se usa**. No hay nada que correr
a mano y no hay ningún momento en que la app esté vacía. Corriendo unas pocas búsquedas ya
se habían migrado 758 de 3910 fichas; el resto entra cuando toque.

## Harakiri segunda

Con las reglas aflojadas, la lista de películas salió así: #1 El increíble castillo
vagabundo, **#2 Harakiri (1962)**, **#3 Los Siete Samuráis (1954)**. Él: *"las primeras 2
veo difícil que me gusten la verdad"*.

Por qué estaban ahí: la regla de las viejas perdona la penalización de época si la
película está muy bien puntuada (`excepcionPreAnioSiNota`), y las dos tienen 8.5 en TMDB.
Pero de sus 286 puntuaciones **dos** son anteriores a 1980, y las dos son El Padrino.
Creerle a TMDB ahí no es recomendarle su gusto, es recomendarle el canon.

Ahora el indulto pide las dos cosas: nota alta **y** que él tenga alguna experiencia con
esa época — al menos 5 puntuadas dentro de ±12 años. Si no, paga la época entera y la
tarjeta lo dice («es de 1962, y de esa época casi no puntuaste nada»). Medido: Harakiri
se fue de #2 a #6 y Los Siete Samuráis de #3 a #10.

## Mis gustos eran MIS gustos

Las dos reglas de arriba, la de los musicales, la de la animación infantil, la de los
bucles temporales y la de «nada anterior al 2000 salvo que esté buenísima» vivían en
`PREFS_POR_DEFECTO`. O sea: **el default de todo el mundo eran mis respuestas**.
Cualquiera que se anotara heredaba mis manías sin haber dicho una palabra, y encima
como varas duras — esas cosas no bajaban de puesto, desaparecían sin dejar rastro.

Ahora el default es neutro. Las reglas siguen estando todas, apagadas; lo único
prendido es lo que no es cuestión de gusto sino de no ofrecer basura (un piso de nota
y de votos) y lo que sale de tus propios datos (las etiquetas con las que puntuaste).
La pantalla de Mis gustos dice de cada regla si es **vara** o **descuento**, que es la
única diferencia que de verdad importa entre dos reglas y estaba enterrada en el texto.

Esto también afloja las reglas de los que ya estaban, porque las que nunca tocaron se
leen del default. Es a propósito: eran justo las que hacían desaparecer títulos en
silencio. Y como contrapeso, `filtrar()` ahora **cuenta** qué tiró cada regla y la
pantalla lo dice abajo de los resultados:

> Tus reglas dejaron afuera 66 títulos en esta búsqueda: 36 por pocos votos, 19 por
> viejas sin nota alta, 11 por nota mínima. Se cambian en Mis gustos.

Sin eso, «hay pelis que me podría ofrecer y nunca lo hizo» no se puede ni empezar a
contestar: la lectura obvia es que el motor no las conoce, y no es eso — las vio y las
tiró porque se lo pediste.

## La marca no se veía nunca

La barra de arriba era parte del scroll: al segundo scroll de una grilla de sesenta
pósters el nombre se iba y la pantalla dejaba de ser de ninguna app en particular. Ahora
es **fija**, con el fondo traslúcido, la marca a la izquierda y lo de la cuenta a la
derecha. La barra lateral del escritorio arranca abajo de ella.

Y la tarjeta pasó a ser **el póster entero**: el título iba en una franja gris debajo, que
sumaba 55px por tarjeta sin mostrar nada que el póster no muestre — en una grilla de seis
columnas eso es una fila de pósters perdida. Ahora va encima, sobre un degradado.

## La barra al costado

En el escritorio la app era una sola columna de 1080px, y arriba de los pósters
estaban el buscador, siete presets, doce géneros, tres casillas y la duración. Para ver
la cuarta recomendación había que achicar el zoom del navegador. Textual: *"para ver
varias de las recomendaciones tengo que achicar mucho la pantalla"*.

Arriba de 1000px la navegación y los filtros se van a una **barra al costado** que se
queda quieta mientras la grilla scrollea, la grilla pasa a seis pósters por fila en vez
de cuatro, y la tanda entera entra sin scrollear. Abajo de 1000px no cambia nada:
sigue siendo una columna, y en el celular la navegación ya vivía abajo, al alcance del
pulgar, que es lo que corresponde en una app.

## Firefly al 82%

La primera vara de ciencia ficción vieja estaba hecha para que quedaran Firefly y
Battlestar Galactica. Nico, al verlas: *"es de hace 24 años, serie de ciencia ficción
que es difícil que esté buena después de tanto tiempo"*; de Battlestar, *"no sé si me
van a gustar por los efectos especiales"*; de Merlín, "un poco lo mismo". Supernatural,
por larga: *"con tantos capítulos es muy difícil que me den ganas de verla, a menos que
duren 20 o 30 min y esté MUUUY BUENA toda la serie"*. Y Dr. Horrible, por musical.

El 82% no mentía sobre lo que mide: Firefly tiene acción, espacio y «heist», que en
sus notas pesan mucho, y un 8.3 en TMDB. Lo que no mide es la edad de los efectos: no
hay ni una serie de ciencia ficción vieja entre sus 43, así que de eso las notas no
enseñan nada. Tiene que ser regla declarada. Tres cambios:

- **Ciencia ficción vieja: casi un no.** De 15 años para atrás —Merlín es de 2008 y con
  20 ni entraba— y nota 8.5 con 2500 votos. Ninguna de las que salían llega: Firefly
  8.3, Supernatural 8.3, Battlestar 8.2, Smallville 8.2, Fringe 8.1, Merlín 7.8.
- **Series larguísimas: capítulo corto y muy buena, o nada.** Era un descuento que
  topaba en -0.8, y Supernatural —327 capítulos de 45 minutos— salía octava. Arriba de
  100 capítulos ahora tiene que durar 30 minutos o menos **y** tener 8.5 con 2500
  votos. El anime también entra: pasa My Hero Academia (170 de 24 minutos, 8.6); se van
  Inuyasha, Black Clover y Dragon Ball Super. Entre 60 y 100 sigue el descuento de siempre.
- **Musicales: bajan, no desaparecen**, porque dijo "habría que ver". Resta 1 por la
  keyword exacta «musical», no por pedazo: «based on play or musical» la tienen montones
  de adaptaciones de teatro que no se cantan (Fleabag). Tampoco por el género Música,
  que es Whiplash.

**Cuánto dura el capítulo.** TMDB lo tiene en `episode_run_time`, que en muchas series
viene vacío. El último capítulo al aire no sirve: en una serie terminada es el final,
que suele ser doble (La Oficina 45 minutos, Lost 105). `completarDuracion()` toma la
mediana de la primera temporada —La Oficina 23, Lost 44—, la pide solo para las de más
de 100 capítulos y queda cacheada. Si ni así se sabe, la serie larga no pasa: no se
puede decir que sea corta.

Con sus datos, «Serie» + «Sin animación»:

| | |
|---|---|
| antes, las primeras 8 | Firefly, See, Alice in Borderland, El último reino, Battlestar, Dr. Horrible, Sherlock, Supernatural |
| ahora, las primeras 8 | See, Alice in Borderland, El último reino, Sherlock, Hermanos de sangre, Tabú, Titanes, The Punisher |
| se fueron | Firefly, Battlestar, Dr. Horrible, Supernatural, Smallville, Fringe, Outlander, Person of Interest, Construyendo un parque |
| entró | La Oficina: 186 capítulos, pero de 23 minutos y con 8.6 |

**Lo que no se tocó, a propósito.** Roma: es de 2005 pero no tiene efectos, y sobre
series viejas sin ciencia ficción sus notas dicen lo contrario —Dr. House 8, Breaking
Bad 10, Prison Break 7—. "Me suena que no me va a gustar, pero son suposiciones" no
alcanza para una regla; para eso está «No me interesa». Tampoco el piloto de hora y
media: Firefly ya no sale, y Sherlock, de capítulos de 90, se saca con «Que no dure
más de N minutos».

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

## Gente que puntúa como vos

Él, después de ver Siete almas: *"teniendo casi 300 cosas puntuadas, no tenés
recomendaciones que sepas que me van a gustar SÍ O SÍ"*. Y después: *"no solo
basarse en actores y directores, porque no siempre me gusta TODO lo que hace un
director y tampoco ODIO todo lo que hace otro"*, *"tiene que funcionar para alguien
que tiene 300 puntuaciones o alguien que tiene 15"*. Lo que quiere, en sus palabras:
que la mayoría de lo que le ofrece sea de 8 para arriba, o un 7 sólido.

Siete almas es el ejemplo exacto. Salió de En busca de la felicidad, su 10: mismo
director (Muccino), mismo protagonista (Will Smith), las dos drama. Para el motor, un
parecido enorme. Lo que le gustó de una y no de la otra —que se entiende desde el
principio, que no da sueño— no está en ningún campo de TMDB. Le puso 6.

**Qué es.** MovieLens (Universidad de Minnesota) publica 32 millones de puntuaciones
de 200.000 personas, hasta octubre de 2023. `armar-vecinas.py` calcula, para cada par
de las 4.396 películas con al menos 1000 puntuaciones, cuánto se parecen las notas que
les puso la gente que vio las dos, descontando la fama de cada película y lo generosa
que es cada persona. Para predecir una película, `vecinas.mjs` mira a cuáles de las
suyas se parece EN ESO y cómo las puntuó él. El director no entra por ningún lado: una
de Muccino que no le gustó a la misma gente no se parece a En busca de la felicidad.

**La nota es tres cuartos motor y un cuarto esto** (abajo, por qué no la mitad),
llevada a la escala del motor para que la vara
y el porcentaje de la tarjeta sigan significando lo mismo. La curva del porcentaje se
calibra con la nota ya mezclada. Series, estrenos posteriores a 2023 y películas poco
conocidas no están en la tabla: siguen solo con el motor, como antes.

### Cómo se midió

Sobre su gusto de hoy (sin «de chico» ni «no tener en cuenta») y sus películas que
están en la tabla. Para simular a alguien con 15, 30 o 60 puntuaciones se sortean
esas de las suyas, se arma el perfil solo con ellas y se le pide que ordene el resto.
Se mira lo que él pidió: **de las 10 que pone arriba, cuántas terminaron en 7 o más y
cuántas en 6 o menos**.

| con | motor solo: 7+ · flojas | con un cuarto de vecinas | gana / pierde contra el motor |
|---|---|---|---|
| 15 | 7.8 · 2.2 | 8.2 · 1.8 | 20 / 6 de 60 sorteos |
| 30 | 8.3 · 1.7 | 8.7 · 1.4 | 15 / 2 de 40 |
| 60 | 8.5 · 1.5 | 9.0 · 1.0 | 11 / 0 de 30 |
| todas | 10 · 0 | 10 · 0 | — |

Con todas, las 10 de arriba ya salían bien con el motor solo (9 con 8+, ninguna
floja): ahí la diferencia está en el resto del orden, AUC 0.717 → 0.764.
`backtest.mjs` lo imprime al final; con las 286 de la compu da 0.772 → 0.802. El
módulo de la app se verificó contra la medición en Python: mismo AUC del motor
(0.717), y con la mitad de peso 0.795 contra 0.790, lo que cuesta guardar la
similitud en un byte.

**Lo que se probó y no entró:**

- *Recortar la tabla a las 100 vecinas de cada película*, lo obvio para que pese
  poco. Con todas sus notas ponía 4 flojas entre las 10 de arriba: casi ninguna de las
  suyas quedaba entre las 100 de la candidata, y la predicción caía al promedio de la
  gente. Va la tabla entera de las conocidas, un byte por par y solo la mitad, porque
  es simétrica: 5.5 MB comprimida.
- *Sacar actores y directores del motor.* Solo, le resta un poco; dentro de la mezcla
  empata o pierde un sorteo más. Se quedaron, pero pesan un cuarto menos que antes: ese
  cuarto de la nota no los mira.
- *Recomendar lo que la gente puntúa alto en general.* Con 15 puntuaciones pone 2.9
  flojas de 10, peor que el motor: hace falta personalizar aunque sea con poco.
- *No leer sus etiquetas.* Recomendaba Pixar: la gente que ama Toy Story ama Up, y
  eso es cierto y no le sirve. «No tener en cuenta» no opina y «de chico» opina un
  tercio, igual que en el motor.

### Una fuente nueva de candidatas

Las otras salen de TMDB y traen siempre el mismo vecindario. Esta trae lo que la gente
con su gusto puntuó alto, y la tarjeta lo dice: *"A la gente que le gustaron Hombres
de honor y En busca de la felicidad como a vos, esta también le gustó."* No propone lo
que sus reglas van a bajar igual —animación que no es anime, y lo anterior a
`anioMinimo` si esa regla resta—: sin eso ofrecía Mulán y El mago de Oz, que ocupaban
los lugares de las que sí servían.

Una búsqueda tarda lo mismo que antes con el cache lleno; la primera vez que la tabla
trae una película nueva hay que pedirle la ficha a TMDB, como a cualquier otra fuente.

### Un cuarto, no la mitad

La primera versión pesaba la mitad. Él la usó: *"ahora me está recomendando mucho
romance, yo no soy fanático de eso"*, *"cambió DEMASIADO las cosas que me recomienda,
hay algunas que capaz no estaban mal"*, *"mucho drama… hoy en día cualquiera es
drama"*, *"encima me recomendó películas viejas"*.

Tenía razón en las tres. De las 8 películas que le mostró, todas habían subido por la
tabla: 3 anteriores a 2000 (Forrest Gump, La sociedad de los poetas muertos, Atrapado
sin salida), 2 de romance y casi todas drama. La medición de arriba no lo podía ver:
cuenta cuántas de las 10 de arriba le gustaron, no cuánto cambia la lista ni de qué
géneros queda.

Dos arreglos:

- **El año mínimo vale para esta fuente igual que para las otras**, que se lo piden a
  TMDB. Estaba atado a que el descuento por vieja estuviera prendido, y él lo tiene en 0.
- **Un cuarto de la nota en vez de la mitad.** En los mismos sorteos, de las 10 de
  arriba cuántas con 7+, y en cuántos sorteos pierde contra el motor solo:

| peso | con 15 | con 30 | con 60 |
|---|---|---|---|
| nada (antes) | 7.8 | 8.3 | 8.5 |
| un cuarto | 8.2 · pierde 6 de 60 | 8.7 · pierde 2 de 40 | 9.0 · pierde 0 de 30 |
| la mitad | 8.4 · pierde 15 de 60 | 8.7 · pierde 7 de 40 | 9.2 · pierde 0 de 30 |

Un cuarto se lleva casi toda la mejora y pierde contra el motor muchas menos veces.

Con sus datos, en una copia de la app y con los mismos pedidos, «Película» queda casi
como antes —El castillo vagabundo, Chihiro, Una mente brillante, Star Trek, Náufrago—
y la tabla suma Orgullo y prejuicio: 1 de 16. Drama, 10 de 32 tarjetas contra 12
antes. Anteriores a 2000, las 3 de Ghibli que ya salían.

**Lo que queda, dicho claro:** con un cuarto, la tabla cambia poco lo que se ve. La
mejora está en el orden fino, y hace falta el marcador para saber si se nota.

**Lo que no cambia, dicho claro:**

- Todo esto se midió sobre películas que él ya eligió ver: afuera va a acertar menos.
  Lo que manda es el marcador de «La vi por acá».
- «Serie» sin filtros sigue siendo casi todo anime: las series no están en MovieLens.
- Nada posterior a octubre de 2023 tiene esta mitad.

### La tabla v2: 12.185 películas en menos espacio

La v1 guardaba el **triángulo entero** de similitudes: un byte por cada par. Eso crece
con el CUADRADO de las películas, así que para que el archivo entrara en 5 MB la tabla
tenía que quedarse en 4.396 — y la app lee **30 vecinas por fila**, o sea que el 99,3%
del archivo no se abría nunca.

Ahora se guardan las **150 vecinas más parecidas de cada una**. Crece lineal:

| | v1 | v2 |
|---|---|---|
| películas | 4.396 | **12.185** |
| archivo | 5,3 MB | **4,9 MB** |
| de los 2010s | 801 | **2.827** |
| de los 2020s | 50 | **442** |
| de sus 243 películas | 212 (87%) | **231 (95%)** |

El piso de votos de MovieLens bajó de 1.000 a 100. Las que tienen pocos votos entran
con similitudes bajas por el encogimiento `n/(n+100)`, así que se protege sola: una
película con 120 votos no se va a colar arriba por ruido.

Las filas se guardan **ordenadas por índice**, no por similitud, porque la app nunca
pide "las vecinas de ésta": pide "cuánto se parecen estas dos", y ordenado por índice
eso es una búsqueda binaria. Como la lista no es simétrica —B puede estar entre las 150
de A sin que A esté entre las 150 de B—, `sim()` mira las dos filas y se queda con la
que aparezca.

**Qué cambió, medido** (mismo backtest, mismas 259 puntuaciones):

    top 10:  3 → 4 de sus 9-10 · 1 → 0 de sus 1-6
    top 30:  7 → 9 de sus 9-10
    mediana de sus 9-10: puesto 73 → 68 de 559
    candidatas del catálogo que pasan su vara: 28 → 33 de 300
    AUC 9-10 contra el catálogo: 0.883 → 0.878 (igual, dentro del ruido)

Y en la lista de verdad aparecieron títulos que **antes no se podían puntuar**: Jujutsu
Kaisen 0, Demon Slayer Mugen Train, Quiero comerme tu páncreas, Paprika, Dragon Ball
Super Broly. Ninguna estaba en las 4.396.

**Lo que NO arregló:** la lista sigue siendo 12 de 12 animadas. La tabla mejora cómo se
PUNTÚA lo que ya se juntó; no cambia de dónde salen las candidatas. Eso es otro trabajo.


### Y de vuelta a la mitad, con la tabla v2

El cuarto se eligió con la tabla vieja, de 4.396 películas, donde el 87% de las suyas
entraba y el catálogo reciente casi no existía. Con la v2 (12.185, el 95% de las suyas)
el cuarto quedó corto. Barrido sobre sus 259, dejando una afuera:

| peso | 0 | 0.25 | 0.35 | 0.45 | **0.55** | 0.7 |
|---|---|---|---|---|---|---|
| AUC de sus 9-10 | .807 | .831 | .835 | .839 | **.842** | .838 |

Se aplana entre 0.45 y 0.55, así que va **0.5**. En el pool realista lo que cambió es
lo de abajo, no lo de arriba: de sus 30 primeras, las que puntuó **1-6 pasaron de 1 a
cero**, y las candidatas del catálogo que pasan su vara de 28 a 35.

**Por qué empuja para el lado correcto.** Sus 33 notas de 9-10: **sólo 7 son animadas**.
Las otras 26 son El Padrino I y II, Breaking Bad, Nueve reinas, El secreto de sus ojos,
La vida es bella, Volver al Futuro, El caballero de la noche, Avengers. Y sin embargo el
perfil le pone a **Animación 3.40**, el peso más alto de todos, arriba de Aventura 2.05
y Drama.

No es un error de la fórmula — probé pesar el z al cubo y contar sólo los 9-10, y
Animación gana igual. Es que **el género es la unidad equivocada** para su lado de
imagen real: sus 30 animadas son un bloque coherente que siempre puntúa arriba de su
media, mientras que sus 26 obras maestras están repartidas en diez géneros distintos y
ninguno junta peso. Lo que une a El Padrino con Nueve reinas y con Breaking Bad no es un
género: es la gente que las ama. Eso el motor de rasgos no lo puede ver y la tabla sí.


### Armarla y subirla

MovieLens no se puede redistribuir ni usar comercialmente, así que la tabla no va al
repo. Se baja `ml-32m.zip` de grouplens.org/datasets/movielens y:

```
python armar-vecinas.py <carpeta de ml-32m>        numpy y pandas, ~1 minuto
node --env-file=.env subir-vecinas.mjs             a la base, para la app publicada
```

La app la busca primero en `data/vecinas.json.gz` y después en la base. Sin ninguna de
las dos arranca igual, solo con el motor, y lo avisa al arrancar. Después de subirla,
la app publicada la lee cuando se reinicia.

En septiembre de 2026 el certificado de files.grouplens.org estaba vencido: se bajó
sin verificarlo y se controló contra el md5 publicado (`d472be33…`).

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
| `idiomasSoloMuyBuenas` + `notaMinimaIdioma` + `votosMinimosIdioma` | Series de imagen real en esos idiomas (`ko`, `zh`, `cn`, `ja`): solo si pasan nota **y** votos. El anime no entra. |
| `aniosSciFiVieja` + `notaMinimaSciFiVieja` + `votosMinimosSciFiVieja` | Series de ciencia ficción o fantasía de esa antigüedad o más: ídem. 0 años la apaga. |
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
| `vecinas.mjs` | gente que puntúa como vos: leer la tabla, predecir, proponer |
| `armar-vecinas.py` | arma esa tabla desde MovieLens (una vez, en tu compu) |
| `subir-vecinas.mjs` | la sube a la base para la app publicada |
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
