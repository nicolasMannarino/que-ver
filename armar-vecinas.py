"""Arma data/vecinas.json.gz: qué películas puntúa parecido la misma gente.

Sale de MovieLens 32M (Universidad de Minnesota): 32 millones de puntuaciones de
200.000 personas, hasta octubre de 2023. Para cada par de películas conocidas,
cuánto se parecen las notas que les puso la gente que vio las dos.

    python armar-vecinas.py <carpeta de ml-32m descomprimida>

Necesita numpy y pandas. Tarda un par de minutos y usa ~4 GB de RAM.

MovieLens no se puede redistribuir ni usar comercialmente: el resultado va a
data/, que no está en el repo, y a la base con `node subir-vecinas.mjs`.
"""
import base64, gzip, json, os, sys, time
import numpy as np, pandas as pd

# Los mismos valores con los que se midió contra sus notas (ver README, «Gente
# que puntúa como vos»). Fijados antes de mirar resultados, no ajustados a él.
LAM_PELI, LAM_PERSONA = 25, 10     # encogimiento de los sesgos
MIN_VOTOS = 1000                   # la tabla solo lleva películas conocidas
ENCOGER = 100                      # similitud × n/(n+100): 20 personas en común no alcanzan
BLOQUE = 8000                      # personas por pasada, para no llenar la RAM

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

# Lo esperable de cada nota: el promedio de todos, cuánto se aparta esa película y
# cuánto se aparta esa persona. Lo que queda es el gusto: lo que la nota dice que
# no dice la fama de la película ni lo generosa que es la persona.
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
pos = -np.ones(len(pelis), np.int64); pos[tabla] = np.arange(K)
m = pos[Ic] >= 0
u, it, e = Uc[m], pos[Ic[m]], resto[m]
o = np.argsort(u, kind="stable"); u, it, e = u[o], it[o], e[o]
log(f"{K:,} películas con ≥{MIN_VOTOS} puntuaciones y ficha en TMDB")

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
log("sumas listas")
with np.errstate(divide="ignore", invalid="ignore"):
    sim = np.nan_to_num(Sxy / np.sqrt(Sxx * Sxx.T) * N / (N + ENCOGER))

# Solo se usan las similitudes positivas, así que va de 0 a 1 en un byte. Y es
# simétrica: se guarda el triángulo de arriba, fila por fila (i < j).
q = np.round(np.clip(sim, 0, 1) * 255).astype(np.uint8)
tri = q[np.triu_indices(K, 1)]

# Año y si es animada, para que la app no gaste lugares en lo que sus reglas van a
# bajar igual («antes de 2000 solo si es muy buena», «animación solo si es anime»).
# Anime = animada y marcada «anime», «studio ghibli»… por al menos dos personas.
movies = pd.read_csv(os.path.join(carpeta, "movies.csv"))
anio_de = {m: int(x) for m, x in zip(movies.movieId, movies.title.str.extract(r"\((\d{4})\)\s*$")[0]) if pd.notna(x)}
animada = set(movies.movieId[movies.genres.str.contains("Animation", na=False)])
tags = pd.read_csv(os.path.join(carpeta, "tags.csv"), usecols=["userId", "movieId", "tag"], dtype={"tag": str})
ANIME = {"anime", "studio ghibli", "ghibli", "hayao miyazaki", "miyazaki", "makoto shinkai", "japanese", "japan"}
cuantos = tags[tags.tag.str.lower().str.strip().isin(ANIME)].groupby("movieId").userId.nunique()
anime = set(cuantos[cuantos >= 2].index) & animada
doc = {
    "version": 1, "fuente": "MovieLens 32M", "hasta": hasta,
    "parametros": {"lamPeli": LAM_PELI, "lamPersona": LAM_PERSONA, "minVotos": MIN_VOTOS, "encoger": ENCOGER},
    "mu": round(mu, 5),
    "tmdb": [int(a_tmdb[pelis[k]]) for k in tabla],
    "sesgo": [round(float(x), 4) for x in sesgo[tabla]],
    "anio": [anio_de.get(pelis[k], 0) for k in tabla],
    "animacion": [2 if pelis[k] in anime else 1 if pelis[k] in animada else 0 for k in tabla],  # 0 no · 1 sí · 2 anime
    "triangulo": base64.b64encode(tri.tobytes()).decode("ascii"),
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
    print(f"  {nombre} -> " + ", ".join(f"{titulos[pelis[tabla[j]]]} {sim[k, j]:.2f}" for j in top))
