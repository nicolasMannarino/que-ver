# Reglas de Proyecto: que-ver

## 1. Comportamiento y Tono (Obligatorio)
- Modo Caveman: Respuestas directas al grano, sin cortesías, introducciones, relleno ni conclusiones. Las frases fragmentadas están bien.
- Cero Condescendencia: Si propongo una mala idea, un diseño subóptimo o una mala práctica, desafíame. Muéstrame la realidad crudamente y argumenta por qué falla. No me des la razón para complacerme.

## 2. Contexto Tecnológico Base
- Recomendador de películas/series sobre puntuaciones propias. Catálogo real vía TMDB; el LLM nunca inventa títulos. Filtro de "ya vistas" = código (por id TMDB), no prompt.
- Node >=22, ESM puro (`.mjs`, `"type": "module"`). Sin framework: `node:http` a mano.
- Única dependencia: `pg` (Postgres/Neon). Todo lo demás con stdlib (`fetch`, `node:fs`, `node:crypto`, `process.loadEnvFile`). No agregar paquetes.
- Front: un solo `public/index.html` (vanilla JS, sin build, PWA con `manifest.webmanifest`).
- Python solo para `armar-vecinas.py` (offline, MovieLens 32M -> `data/vecinas.json.gz`).
- Arquitectura: módulos planos en la raíz, sin capas formales.
  - `server.mjs`: HTTP + rutas API.
  - `motor.mjs`: perfil de gusto, candidatos, ranking.
  - `vecinas.mjs`: predicción por "gente que puntúa como vos".
  - `tmdb.mjs`: cliente TMDB + cache en disco.
  - `ratings.mjs`: parsers (CSV IMDb, txt).
  - `datos.mjs`: usuarios/puntuaciones; rutas = claves del almacén.
  - `almacen.mjs`: backend dual con MISMA interfaz síncrona: disco (`data/`) o Postgres (si hay `DATABASE_URL`).
  - `auth.mjs`: cuentas, sesiones, API key cifrada por usuario.
- Dos modos: local (sin auth, escucha solo `127.0.0.1`) y publicado (Render + Neon, con cuentas; `DATABASE_URL` lo activa).
- Deploy: `render.yaml`. `data/` y `.env` están en `.gitignore`; nunca commitear.
- Idioma del código, comentarios, UI y commits: español rioplatense.

## 3. Estilo de Código (Modo Ponytail / YAGNI)
- Aplica YAGNI estrictamente. Escribe la solución más simple y directa posible.
- Entrega únicamente el diff necesario. No reescribas archivos completos.
- Usa la biblioteca estándar o herramientas nativas del framework antes de sugerir instalar un paquete nuevo.
- No sobre-diseñes ni anticipes código para funciones futuras que no pedí.
- Imita el estilo existente: comentarios en español que explican el porqué, no el qué.

## 4. Guardrails Arquitectónicos y Flujo
- Límites de Arquitectura: Respeta la separación de responsabilidades. Si detectas Clean Architecture, está estrictamente prohibido acoplar el Dominio/Core a la Infraestructura. Acá no hay capas formales, pero: `motor.mjs`/`vecinas.mjs`/`ratings.mjs` no tocan disco ni Postgres directo (pasan por `datos.mjs`/`almacen.mjs`); ningún código fuera de `almacen.mjs` sabe qué backend corre.
- Invariante: nada puntuado/visto/descartado puede reaparecer en recomendaciones. Comparar por id TMDB, nunca por título.
- Base de Datos: Si hay un ORM (como Entity Framework), prepara el código pero NO ejecutes comandos de migración de forma autónoma a menos que te lo pida explícitamente. Acá no hay ORM: `pg` directo. Igual: no ejecutes nada contra `DATABASE_URL` (Neon de producción) ni `subir-*.mjs` sin pedido explícito; `subir-mis-datos.mjs` con `--ensayo` es lo único seguro.
- Secretos: no leer, imprimir ni pegar `.env`, `data/secreto.json` ni `data/config.json`.
- Validación: Antes de confirmar que un error está solucionado, ejecuta silenciosamente el comando de compilación correspondiente (ej. `dotnet build` o el validador de JS/TS) para asegurar que no rompiste la build. Acá no hay build: correr `node --check <archivo>.mjs` y `npm test`. Si tocaste `public/index.html`, sumar `npm run test:front`; si tocaste auth, `npm run test:auth`; si tocaste `almacen.mjs`, `npm run test:almacen` y `npm run test:dos`.
- Control de Versiones: Al hacer commits, usa Conventional Commits en español e imperativo (`feat:`, `fix:`, `refactor:`).
