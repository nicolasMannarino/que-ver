"""Arma data/vecinas.json.gz: que peliculas puntua parecido la misma gente.

Sale de MovieLens 32M (Universidad de Minnesota): 32 millones de puntuaciones de
200.000 personas, hasta octubre de 2023. Para cada par de peliculas conocidas,
cuanto se parecen las notas que les puso la gente que vio las dos.

    python armar-vecinas.py <carpeta de ml-32m descomprimida>

Necesita numpy y pandas. Tarda entre veinte minutos y una hora y usa ~4 GB de RAM.

MovieLens no se puede redistribuir ni usar comercialmente: el resultado va a
data/, que no esta en el repo, y a la base con `node subir-vecinas.mjs`.

VERSION 2 - por que cambio el formato
La v1 guardaba el triangulo entero de similitudes: 4.396 x 4.396 / 2 bytes. Eso
obligaba a que la tabla fuera chica, porque el archivo crece con el CUADRADO de
las peliculas: con 4.396 quedaban afuera tres de cada cuatro de las que el puntuo
fuera de los grandes exitos (Argentina 1985, Los Fabelman, Tetris). Y la app lee
30 vecinas por fila: el 99,3% del archivo no se abria nunca.
Ahora se guardan las K vecinas mas parecidas de cada una. El archivo crece LINEAL
con las peliculas, asi que en el mismo tamano entran casi tres veces mas.
"""
import base64, gzip, json, os, sys, time
import numpy as np, pandas as pd

# El ano entre parentesis al final del titulo de MovieLens: "Toy Story (1995)".
PATRON_ANIO = chr(92) + "((" + chr(92) + "d{4})" + chr(92) + ")" + chr(92) + "s*$"

# Los mismos valores con los que se midio (ver README). Fijados antes de mirar
# resultados, no ajustados a el.
LAM_PELI, LAM_PERSONA = 25, 10     # encogimiento de los sesgos
MIN_VOTOS = 100                    # antes 1000, que daban 4.396 peliculas. Ahora ~12.200
ENCOGER = 100                      # similitud x n/(n+100): 20 personas en comun no alcanzan
BLOQUE = 8000                      # personas por pasada, para no llenar la RAM
K_VECINOS = 150                    # cuantas vecinas se guardan de cada una

# La app usa las 30 mas parecidas de las TUYAS, no las 30 de la pelicula. Con 150
# guardadas, las tuyas que de verdad se le parecen caen adentro salvo en casos muy
# raros; con 30 se perdian. Cuesta 3 bytes por vecina y por pelicula.

t0 = time.time()
def log(*a): print(f"[{time.time() - t0:6.1f}s]", *a, flush=True)

carpeta = sys.argv[1] if len(sys.argv) > 1 else "ml-32m"
salida = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "vecinas.json.gz")

r = pd.read_csv(os.path.join(carpeta, "ratings.csv"),
                dtype={"userId": np.int32, "movieId": np.int32, "rating": np.float32, "timestamp": np.int64})
hasta = pd.to_datetime(r.timestamp.max(), unit="s").strftime("%Y-%m")
U, I, R = r.userId.values, r.movieId.values, r.rating.values
del r
log(f"{len(R):,} puntuaciones, hasta {hasta}")

# Lo esperable de cada nota: el promedio de todos, cuanto se aparta esa pelicula y
# cuanto se aparta esa persona. Lo que queda es el gusto: lo que la nota dice que
# no dice la fama de la pelicula ni lo generosa que es la persona.
pelis, Ic = np.unique(I, return_inverse=True)
personas, Uc = np.unique(U, return_inverse=True)
n_peli = np.bincount(Ic)
mu = float(R.mean())
sesgo = np.bincount(Ic, weights=R - mu) / (n_peli + LAM_PELI)
r1 = R - mu - sesgo[Ic]
sesgo_persona = np.bincount(Uc, weights=r1) / (np.bincount(Uc) + LAM_PERSONA)
resto = (r1 - sesgo_persona[Uc]).astype(np.float32)
del r1

links = pd.read_csv(os.path.join(carpeta, "links.csv")).dropna(subset=["tmdbId"])
a_tmdb = dict(zip(links.movieId, links.tmdbId.astype(int)))
tabla = np.array([k for k in np.where(n_peli >= MIN_VOTOS)[0] if a_tmdb.get(pelis[k], 0) > 0])
K = len(tabla)
if K > 65535:
    raise SystemExit(f"{K:,} peliculas no entran en un indice de 2 bytes: subi MIN_VOTOS")
pos = -np.ones(len(pelis), np.int64); pos[tabla] = np.arange(K)
m = pos[Ic] >= 0
u, it, e = Uc[m], pos[Ic[m]], resto[m]
o = np.argsort(u, kind="stable"); u, it, e = u[o], it[o], e[o]
log(f"{K:,} peliculas con {MIN_VOTOS}+ puntuaciones y ficha en TMDB ({K * K * 4 * 3 / 1e9:.1f} GB de acumuladores)")

# Pearson entre quienes vieron las dos: tres sumas por par, de a bloques de personas.
Sxy = np.zeros((K, K), np.float32); Sxx = np.zeros((K, K), np.float32); N = np.zeros((K, K), np.float32)
cortes = np.searchsorted(u, np.arange(0, len(personas) + BLOQUE, BLOQUE))
for b in range(len(cortes) - 1):
    a, f = cortes[b], cortes[b + 1]
    if a == f: continue
    filas = u[a:f] - u[a]
    X = np.zeros((filas.max() + 1, K), np.float32); X[filas, it[a:f]] = e[a:f]
    B = np.zeros_like(X); B[filas, it[a:f]] = 1
    Sxy += X.T @ X; Sxx += (X * X).T @ B; N += B.T @ B
    if b % 4 == 0: log(f"  personas {b * BLOQUE:,} de {len(personas):,}")
log("sumas listas")
with np.errstate(divide="ignore", invalid="ignore"):
    sim = np.nan_to_num(Sxy / np.sqrt(Sxx * Sxx.T) * N / (N + ENCOGER))
del Sxy, Sxx, N
np.fill_diagonal(sim, 0)
np.clip(sim, 0, 1, out=sim)

# Las K_VECINOS mas parecidas de cada fila. Se guardan ORDENADAS POR INDICE, no por
# similitud: la app nunca pide "las vecinas de esta", pide "cuanto se parecen estas
# dos", y ordenadas por indice eso es una busqueda binaria.
log("buscando las vecinas de cada una")
idx = np.full((K, K_VECINOS), 65535, np.uint16)
val = np.zeros((K, K_VECINOS), np.uint8)
for i0 in range(0, K, 512):
    i1 = min(i0 + 512, K)
    bloque = sim[i0:i1]
    top = np.argpartition(-bloque, K_VECINOS, axis=1)[:, :K_VECINOS]
    for j in range(i1 - i0):
        fila = top[j]
        vivas = np.sort(fila[bloque[j, fila] > 0])
        if not len(vivas): continue
        idx[i0 + j, :len(vivas)] = vivas
        val[i0 + j, :len(vivas)] = np.round(bloque[j, vivas] * 255).astype(np.uint8)
guardadas = int((idx != 65535).sum())
log(f"guardadas {guardadas:,} similitudes ({guardadas / K:.0f} por pelicula)")

# Ano y si es animada, para que la app no gaste lugares en lo que sus reglas van a
# bajar igual. Anime = animada y marcada "anime", "studio ghibli"... por dos personas.
movies = pd.read_csv(os.path.join(carpeta, "movies.csv"))
anio_de = {m: int(x) for m, x in zip(movies.movieId, movies.title.str.extract(PATRON_ANIO)[0]) if pd.notna(x)}
animada = set(movies.movieId[movies.genres.str.contains("Animation", na=False)])
tags = pd.read_csv(os.path.join(carpeta, "tags.csv"), usecols=["userId", "movieId", "tag"], dtype={"tag": str})
ANIME = {"anime", "studio ghibli", "ghibli", "hayao miyazaki", "miyazaki", "makoto shinkai", "japanese", "japan"}
cuantos = tags[tags.tag.str.lower().str.strip().isin(ANIME)].groupby("movieId").userId.nunique()
anime = set(cuantos[cuantos >= 2].index) & animada
doc = {
    "version": 2, "fuente": "MovieLens 32M", "hasta": hasta,
    "parametros": {"lamPeli": LAM_PELI, "lamPersona": LAM_PERSONA, "minVotos": MIN_VOTOS,
                   "encoger": ENCOGER, "vecinos": K_VECINOS},
    "mu": round(mu, 5),
    "k": K_VECINOS,
    "tmdb": [int(a_tmdb[pelis[k]]) for k in tabla],
    "sesgo": [round(float(x), 4) for x in sesgo[tabla]],
    "anio": [anio_de.get(pelis[k], 0) for k in tabla],
    "animacion": [2 if pelis[k] in anime else 1 if pelis[k] in animada else 0 for k in tabla],
    # Little endian explicito: del otro lado lo lee un Uint16Array, que usa el orden
    # de la maquina. En x86 y ARM coinciden, pero mejor no depender de eso.
    "indices": base64.b64encode(idx.astype("<u2").tobytes()).decode("ascii"),
    "similitudes": base64.b64encode(val.tobytes()).decode("ascii"),
}
os.makedirs(os.path.dirname(salida), exist_ok=True)
with gzip.open(salida, "wt", encoding="utf8") as f:
    json.dump(doc, f)
log(f"{salida}: {os.path.getsize(salida) / 1e6:.1f} MB")

# A ojo: las vecinas de una conocida, para ver que la tabla dice algo con sentido.
log(f"animadas {sum(pelis[k] in animada for k in tabla)}, de ellas anime {sum(pelis[k] in anime for k in tabla)}")
titulos = dict(zip(movies.movieId, movies.title))
for nombre in ("Toy Story (1995)", "Memento (2000)"):
    k = next((i for i, x in enumerate(tabla) if titulos.get(pelis[x]) == nombre), None)
    if k is None: continue
    top = [j for j in np.argsort(-sim[k])[:7] if j != k][:6]
    print("  " + nombre + " -> " + ", ".join(f"{titulos[pelis[tabla[j]]]} {sim[k, j]:.2f}" for j in top))
