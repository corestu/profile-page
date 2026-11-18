@echo off
rem ---------------------------------------------------------------
rem  Local preview: build a page that points at ./assets/ and serve it
rem  over HTTP. Opening index.html from disk will not show the glass
rem  effect -- file:// blocks the video -> WebGL texture upload.
rem ---------------------------------------------------------------
setlocal
cd /d "%~dp0"

set "PORT=8899"
set "OUT=_preview.html"

if not exist "index.html" (
    echo Missing index.html
    exit /b 1
)
if not exist "assets\bg.js" (
    echo Missing assets folder
    exit /b 1
)

echo [preview] rewriting CDN urls to local assets ...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ErrorActionPreference = 'Stop';" ^
    "$h = [IO.File]::ReadAllText('index.html');" ^
    "$h = $h -replace 'https://cdn\.aistu\.cn/static/home/assets/','./assets/';" ^
    "$h = $h -replace '\?v=[0-9a-f]{8}','';" ^
    "[IO.File]::WriteAllText('%OUT%', $h, (New-Object Text.UTF8Encoding($false)))"
if errorlevel 1 (
    echo [preview] failed to build %OUT%
    exit /b 1
)

set "PY="
where python >nul 2>nul
if not errorlevel 1 set "PY=python"
if not defined PY (
    where py >nul 2>nul
    if not errorlevel 1 set "PY=py -3"
)
if not defined PY (
    echo [preview] Python not found. Use any static server in this folder
    echo           and open /%OUT% from it.
    pause
    exit /b 1
)

echo.
echo [preview] http://127.0.0.1:%PORT%/%OUT%
echo [preview] close this window to stop the server
echo.

start "" "http://127.0.0.1:%PORT%/%OUT%"
%PY% -m http.server %PORT% --bind 127.0.0.1
