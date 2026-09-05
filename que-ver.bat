@echo off
chcp 65001 >nul
title Qué Ver
cd /d "%~dp0"

if "%PORT%"=="" set "PORT=5173"
set "SINCRONIZADO=no"

echo.
echo    Qué Ver
echo    --------------------------------------------------
echo.

REM ------------------------------------------------------------------
REM  1. Node. Sin esto no hay nada que hacer.
REM ------------------------------------------------------------------
where node >nul 2>&1
if errorlevel 1 goto :sin_node

REM ------------------------------------------------------------------
REM  2. La misma versión que está publicada en la web.
REM     Sale del mismo lugar: la rama del repo que Render despliega.
REM ------------------------------------------------------------------
where git >nul 2>&1
if errorlevel 1 (
    echo    [ ] No tenés git: arranco con lo que hay en el disco.
    goto :dependencias
)

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
    echo    [ ] Esta carpeta no es un repo de git: arranco con lo que hay.
    goto :dependencias
)

REM Cambios sin guardar: no piso nada, ni siquiera para actualizar.
git diff --quiet 2>nul
if errorlevel 1 goto :hay_cambios
git diff --cached --quiet 2>nul
if errorlevel 1 goto :hay_cambios

for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "RAMA=%%b"
if "%RAMA%"=="" set "RAMA=master"

echo    Viendo si hay algo nuevo en GitHub...
git fetch --quiet origin %RAMA% 2>nul
if errorlevel 1 (
    echo    [ ] Sin internet o GitHub no contesta: arranco con lo que hay.
    goto :dependencias
)

set "ATRASO="
for /f "delims=" %%c in ('git rev-list --count HEAD..origin/%RAMA% 2^>nul') do set "ATRASO=%%c"
if "%ATRASO%"=="" set "ATRASO=0"

if "%ATRASO%"=="0" (
    echo    Ya tenés la última: es la misma que está publicada.
    goto :dependencias
)

echo    Bajando %ATRASO% cambio^(s^)...
git merge --ff-only origin/%RAMA% >nul 2>&1
if errorlevel 1 (
    echo    [!] No pude adelantar sin mezclar. Fijate con: git status
    goto :dependencias
)
set "SINCRONIZADO=si"
echo    Actualizado.
goto :dependencias

:hay_cambios
echo    [!] Tenés cambios sin commitear en esta carpeta.
echo        No bajo nada para no pisártelos, así que esto corre TU versión,
echo        que puede no ser la que está publicada en la web.
goto :dependencias

REM ------------------------------------------------------------------
REM  3. Dependencias
REM ------------------------------------------------------------------
:dependencias
if not exist "node_modules\" (
    echo    Instalando dependencias. La primera vez tarda un poco...
    call npm install --no-audit --no-fund
    if errorlevel 1 goto :sin_dependencias
    goto :arrancar
)
if "%SINCRONIZADO%"=="si" (
    echo    Revisando dependencias...
    call npm install --no-audit --no-fund >nul 2>&1
)

REM ------------------------------------------------------------------
REM  4. Arrancar
REM ------------------------------------------------------------------
:arrancar
REM El .env es lo que conecta esta copia con la base de la nube. Con él, lo que
REM puntuás acá se ve en la web y al revés; sin él, la app corre sola contra los
REM archivos de data/ y las dos cosas se separan.
set "ENVFILE="
if not exist ".env" goto :sin_env

set "ENVFILE=--env-file=.env"

REM El .env tiene la contraseña de la base y el secreto que descifra las API
REM keys. .gitignore ya lo cubre, pero si alguna vez alguien lo fuerza dentro
REM del repo esto lo grita antes de que salga en un push.
git check-ignore -q .env 2>nul
if errorlevel 1 (
    echo.
    echo    [!] CUIDADO: git NO esta ignorando .env.
    echo        Ese archivo tiene la clave de la base. Revisa .gitignore
    echo        antes de commitear nada.
    echo.
)
echo    Datos: la base de la nube ^(lo mismo que ves en la web^)
goto :abrir

:sin_env
echo    Datos: archivos de data/ en esta compu ^(NO es lo que ves en la web^)
echo           Para ver lo mismo que la web: copia .env.example a .env
echo           y pega DATABASE_URL y SESSION_SECRET desde Render.

:abrir
echo.
echo    Abriendo http://localhost:%PORT%
echo    Para cortar: Ctrl+C, o cerrá esta ventana.
echo.

REM El navegador se abre recién cuando el server contesta, no antes.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 60;$i++){try{$null=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:%PORT%/api/sesion' -TimeoutSec 2;Start-Process 'http://localhost:%PORT%';break}catch{Start-Sleep -Milliseconds 500}}"

node %ENVFILE% server.mjs

echo.
echo    El servidor se detuvo.
pause
exit /b 0

REM ------------------------------------------------------------------
REM  Salidas cortas
REM ------------------------------------------------------------------
:sin_node
echo    [X] No encuentro Node en esta compu.
echo        Instalalo desde https://nodejs.org  (hace falta la 22 o más nueva)
echo.
pause
exit /b 1

:sin_dependencias
echo.
echo    [X] Falló npm install. Sin dependencias no arranca.
echo        Probá correr a mano:  npm install
echo.
pause
exit /b 1
