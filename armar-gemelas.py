"""Arma data/gemelas.json.gz: un panel de gente de MovieLens con sus notas, para
encontrar a las que puntuan como vos (gemelas.mjs).

La tabla de vecinas compara peliculas contra peliculas. Esto compara PERSONAS: busca
a las que le pusieron notas parecidas a las tuyas a las mismas peliculas, y mira que
mas puntuaron alto. Medido sobre las 207 de el en la tabla, dejando cada una afuera:
en las 20 que pone arriba la app sola tenia 17 con 7+ y 3 flojas; con gemelas, 20 y
ninguna. En 268 de 300 remuestreos quedan menos flojas arriba, en 3 mas.

    python armar-gemelas.py <carpeta de ml-32m descomprimida>

Necesita numpy, pandas y data/vecinas.json.gz (usa sus mismas peliculas). Tarda un
par de minutos.

El panel: 40.000 personas al azar entre las que puntuaron de 100 a 600 peliculas
de la tabla. Las 200.000 no entran en el plan gratis (31 millones de notas); las
10.000 mas activas median igual arriba pero peor en el top 40, y son casi lo mismo
de grandes. Asi: ~9 millones de notas, ~27 MB en memoria.

Se guarda por pelicula (quien la vio y que nota le puso): es lo unico que necesita
la app, tanto para encontrar a tus gemelas —mirando tus peliculas— como para
predecir una candidata. MovieLens no se redistribuye: va a data/ y a la base con
`node subir-gemelas.mjs`, nunca al repo.
"""
import base64, gzip, json, os, sys, time
import numpy as np, pandas as pd

PERSONAS = 40000
MIN_NOTAS, MAX_NOTAS = 100, 600
LAM_PERSONA = 10       # encogimiento de la media de cada uno, como en armar-vecinas.py

t0 = time.time()
def log(*a): print(f"[{time.time() - t0:6.1f}s]", *a, flush=True)

carpeta = sys.argv[1] if len(sys.argv) > 1 else "ml-32m"
aqui = os.path.dirname(os.path.abspath(__file__))
salida = os.path.join(aqui, "data", "gemelas.json.gz")

tabla = json.load(gzip.open(os.path.join(aqui, "data", "vecinas.json.gz")))
links = pd.read_csv(os.path.join(carpeta, "links.csv")).dropna(subset=["tmdbId"])
t2m = dict(zip(links.tmdbId.astype(np.int64), links.movieId.astype(np.int64)))
tmdb = [t for t in tabla["tmdb"] if t in t2m]
fila = {t2m[t]: i for i, t in enumerate(tmdb)}

r = pd.read_csv(os.path.join(carpeta, "ratings.csv"), usecols=[0, 1, 2],
                dtype={"userId": np.int32, "movieId": np.int32, "rating": np.float32})
r = r[r.movieId.isin(fila.keys())]
log(f"{len(r):,} notas de peliculas de la tabla")

cnt = r.userId.value_counts()
elegibles = cnt[(cnt >= MIN_NOTAS) & (cnt <= MAX_NOTAS)].index.values
rng = np.random.default_rng(1)   # la misma semilla con la que se midio
panel = np.sort(rng.choice(elegibles, min(PERSONAS, len(elegibles)), replace=False))
r = r[r.userId.isin(panel)]
log(f"panel: {len(panel):,} personas, {len(r):,} notas")

persona = np.searchsorted(panel, r.userId.values).astype(np.uint16)
peli = np.array([fila[m] for m in r.movieId.values], dtype=np.int64)
nota = r.rating.values
mu = float(nota.mean())
n_p = np.bincount(persona, minlength=len(panel))
media = ((np.bincount(persona, nota, minlength=len(panel)) + LAM_PERSONA * mu) / (n_p + LAM_PERSONA)).astype(np.float32)

orden = np.lexsort((persona, peli))
inicio = np.zeros(len(tmdb) + 1, dtype=np.uint32)
np.cumsum(np.bincount(peli, minlength=len(tmdb)), out=inicio[1:])

b64 = lambda a: base64.b64encode(np.ascontiguousarray(a).astype(a.dtype.newbyteorder("<")).tobytes()).decode()
hasta = tabla.get("hasta")
doc = {
    "version": 1, "hasta": hasta, "tmdb": tmdb, "personas": len(panel),
    "inicio": b64(inicio),
    "quien": b64(persona[orden]),
    # Media estrella = 1: 0.5 a 5 estrellas son 1 a 10, su misma escala.
    "nota": b64((nota[orden] * 2).round().astype(np.uint8)),
    "media": b64(media),
}
with gzip.open(salida, "wt", encoding="utf8") as f:
    json.dump(doc, f)
log(f"listo: {salida} ({os.path.getsize(salida) / 1e6:.1f} MB)")
