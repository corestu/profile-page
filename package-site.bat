@echo off
setlocal enabledelayedexpansion
rem ================================================================
rem  Static site packaging
rem
rem  Server package : index.html + favicon.ico + robots.txt + sitemap.xml,
rem                   kept as-is (no precompression)
rem  CDN package    : every static asset (images, video, css, js)
rem                   under assets\, with brotli (.br) and gzip (.gz)
rem                   beside the text files for brotli_static /
rem                   gzip_static
rem
rem  index.html carries ?v=<sha256-8> on every CDN url; the staging
rem  step recomputes it from the current files, so a changed css/js
rem  never ships behind a stale 30-day CDN cache.
rem
rem  Usage: package-site.bat [output directory]
rem  Output: pack\<site>.zip      index.html only, versions refreshed
rem          pack\<site>-cdn.zip  assets\ + precompressed text files
rem ================================================================

set "SITE_DIR=%~dp0"
set "SITE_DIR=%SITE_DIR:~0,-1%"

for %%I in ("%SITE_DIR%") do (
    set "SITE_NAME=%%~nxI"
    set "PARENT_DIR=%%~dpI"
)
set "PARENT_DIR=%PARENT_DIR:~0,-1%"

if "%~1"=="" (
    set "OUT_DIR=%SITE_DIR%\pack"
) else (
    set "OUT_DIR=%~1"
)

if not exist "%OUT_DIR%" (
    mkdir "%OUT_DIR%"
    if errorlevel 1 (
        echo Failed to create output directory: %OUT_DIR%
        exit /b 1
    )
)
for %%I in ("%OUT_DIR%") do set "OUT_DIR=%%~fI"

set "OUTPUT_PATH=%OUT_DIR%\%SITE_NAME%.zip"
set "CDN_OUTPUT_PATH=%OUT_DIR%\%SITE_NAME%-cdn.zip"

set "STAGE_ROOT=%TEMP%\site-pack-%SITE_NAME%"
set "STAGE_SITE_DIR=%STAGE_ROOT%\site"
set "STAGE_CDN_DIR=%STAGE_ROOT%\cdn"

call :purge_dir "%STAGE_ROOT%"
if errorlevel 1 goto :cleanup_error
mkdir "%STAGE_SITE_DIR%"
mkdir "%STAGE_CDN_DIR%"

call :stage_site
if errorlevel 1 goto :cleanup_error

call :stage_cdn
if errorlevel 1 goto :cleanup_error

set "BROTLI="
where brotli >nul 2>nul
if not errorlevel 1 set "BROTLI=brotli"
if not defined BROTLI call :locate_brotli

set "GZIP="
where gzip >nul 2>nul
if not errorlevel 1 set "GZIP=gzip"
if not defined GZIP call :locate_gzip

if not defined BROTLI (
    echo brotli not found in PATH or Git install, cannot precompress.
    goto :cleanup_error
)
if not defined GZIP (
    echo gzip not found in PATH or Git install, cannot precompress.
    goto :cleanup_error
)

rem  Only the CDN package is precompressed; the server keeps index.html raw.
call :precompress "%STAGE_CDN_DIR%" cdn
if errorlevel 1 goto :cleanup_error

set "ZIP_SOURCE=%STAGE_SITE_DIR%"
set "ZIP_DEST=%OUTPUT_PATH%"
call :run_zip
if errorlevel 1 goto :cleanup_error

set "ZIP_SOURCE=%STAGE_CDN_DIR%"
set "ZIP_DEST=%CDN_OUTPUT_PATH%"
call :run_zip
if errorlevel 1 goto :cleanup_error

call :purge_dir "%STAGE_ROOT%"

echo.
echo Server package generated: %OUTPUT_PATH%
echo CDN package generated:    %CDN_OUTPUT_PATH%
endlocal
exit /b 0

rem ----------------------------------------------------------------
rem  Server: index.html only, version tags refreshed
rem ----------------------------------------------------------------
:stage_site
if not exist "%SITE_DIR%\index.html" (
    echo Missing source file: %SITE_DIR%\index.html
    exit /b 1
)
copy /y "%SITE_DIR%\index.html" "%STAGE_SITE_DIR%\index.html" >nul
if errorlevel 1 (
    echo Failed to copy index.html
    exit /b 1
)

rem  favicon.ico lives on the origin server, served from the site root
if not exist "%SITE_DIR%\favicon.ico" (
    echo Missing source file: %SITE_DIR%\favicon.ico
    exit /b 1
)
copy /y "%SITE_DIR%\favicon.ico" "%STAGE_SITE_DIR%\favicon.ico" >nul
if errorlevel 1 (
    echo Failed to copy favicon.ico
    exit /b 1
)

rem  robots.txt and sitemap.xml are served from the site root
for %%F in (robots.txt sitemap.xml) do (
    if not exist "%SITE_DIR%\%%F" (
        echo Missing source file: %SITE_DIR%\%%F
        exit /b 1
    )
    copy /y "%SITE_DIR%\%%F" "%STAGE_SITE_DIR%\%%F" >nul
    if errorlevel 1 (
        echo Failed to copy %%F
        exit /b 1
    )
)

set "STAMP_SRC=%SITE_DIR%\assets"
set "STAMP_ROOT=%SITE_DIR%"
set "STAMP_HTML=%STAGE_SITE_DIR%\index.html"
set "STAMP_SITE=%STAGE_SITE_DIR%"
call :stamp_versions
if errorlevel 1 (
    echo Failed to stamp asset versions into index.html
    exit /b 1
)
exit /b 0

rem ----------------------------------------------------------------
rem  Cache busting: rewrite ?v= with the first 8 hex of SHA-256
rem ----------------------------------------------------------------
:stamp_versions
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ErrorActionPreference = 'Stop';" ^
    "$src = $env:STAMP_SRC; $html = $env:STAMP_HTML;" ^
    "$files = @('style.css','bg.js','aurora.mp4','avatar.webp','favicon.ico','icon-32.png','icon-192.png','apple-touch-icon.png');" ^
    "$text = [System.IO.File]::ReadAllText($html);" ^
    "foreach ($f in $files) {" ^
    "    $p = Join-Path $src $f;" ^
    "    if (-not (Test-Path -LiteralPath $p)) { continue };" ^
    "    $h = (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.Substring(0,8).ToLower();" ^
    "    $text = [regex]::Replace($text, 'assets/' + [regex]::Escape($f) + '(\?v=[0-9a-f]+)?', 'assets/' + $f + '?v=' + $h);" ^
    "}" ^
    "$fp = Join-Path $env:STAMP_ROOT 'favicon.ico';" ^
    "if (Test-Path -LiteralPath $fp) {" ^
    "    $fh = (Get-FileHash -LiteralPath $fp -Algorithm SHA256).Hash.Substring(0,8).ToLower();" ^
    "    $text = [regex]::Replace($text, '(\./)?favicon\.ico(\?v=[0-9a-f]+)?', '$1favicon.ico?v=' + $fh);" ^
    "}" ^
    "[System.IO.File]::WriteAllText($html, $text, (New-Object System.Text.UTF8Encoding($false)));" ^
    "$sm = Join-Path $env:STAMP_SITE 'sitemap.xml';" ^
    "if (Test-Path -LiteralPath $sm) {" ^
    "    $d = (Get-Date).ToString('yyyy-MM-dd');" ^
    "    $st = [System.IO.File]::ReadAllText($sm);" ^
    "    $st = [regex]::Replace($st, '<lastmod>[^<]*</lastmod>', '<lastmod>' + $d + '</lastmod>');" ^
    "    [System.IO.File]::WriteAllText($sm, $st, (New-Object System.Text.UTF8Encoding($false)));" ^
    "}"

if %ERRORLEVEL% NEQ 0 (
    echo version stamping failed with exit code %ERRORLEVEL%.
    exit /b %ERRORLEVEL%
)
exit /b 0

rem ----------------------------------------------------------------
rem  CDN: the whole assets folder, mirroring the site structure
rem ----------------------------------------------------------------
:stage_cdn
if not exist "%SITE_DIR%\assets" (
    echo Missing asset directory: %SITE_DIR%\assets
    exit /b 1
)
robocopy "%SITE_DIR%\assets" "%STAGE_CDN_DIR%\assets" /E /XA:SH ^
    /XF "favicon.ico" "*.br" "*.gz" "*.zip" "*.tar" "*.log" ".DS_Store" "Thumbs.db"
if %ERRORLEVEL% GTR 7 (
    echo robocopy failed while staging CDN assets with exit code %ERRORLEVEL%.
    exit /b %ERRORLEVEL%
)

rem  Drop any stale compressed copies carried in from the source tree
call :purge_pattern "%STAGE_CDN_DIR%" "*.br"
call :purge_pattern "%STAGE_CDN_DIR%" "*.gz"
exit /b 0

rem ----------------------------------------------------------------
rem  Precompression: text types only, media would only grow
rem ----------------------------------------------------------------
:precompress
set "PC_DIR=%~1"
set "PC_LABEL=%~2"
set "PC_BR=0"
set "PC_GZ=0"
for %%E in (".html" ".htm" ".css" ".js" ".json" ".svg" ".xml" ".txt" ".webmanifest") do (
    for /f "delims=" %%F in ('dir "%PC_DIR%\*%%~E" /s /b 2^>nul') do (
        "%BROTLI%" -q 11 -kf "%%F"
        if errorlevel 1 (
            echo brotli failed on: %%F
            exit /b 1
        )
        set /a PC_BR+=1
        "%GZIP%" -9 -n -kf "%%F"
        if errorlevel 1 (
            echo gzip failed on: %%F
            exit /b 1
        )
        set /a PC_GZ+=1
    )
)
echo [!PC_LABEL!] brotli !PC_BR! file(s), gzip !PC_GZ! file(s).
exit /b 0

rem ----------------------------------------------------------------
rem  Zip: UTF-8 entry names
rem ----------------------------------------------------------------
:run_zip
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ErrorActionPreference = 'Stop';" ^
    "Add-Type -AssemblyName System.IO.Compression;" ^
    "Add-Type -AssemblyName System.IO.Compression.FileSystem;" ^
    "$source = $env:ZIP_SOURCE;" ^
    "$dest = $env:ZIP_DEST;" ^
    "$encoding = [System.Text.Encoding]::UTF8;" ^
    "$stream = [System.IO.File]::Open($dest, [System.IO.FileMode]::Create);" ^
    "try {" ^
    "    $zip = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create, $false, $encoding);" ^
    "    try {" ^
    "        Get-ChildItem -LiteralPath $source -Recurse -File | ForEach-Object {" ^
    "            $relative = $_.FullName.Substring($source.Length).TrimStart('\');" ^
    "            $entryName = $relative -replace '\\', '/';" ^
    "            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null;" ^
    "        }" ^
    "    } finally {" ^
    "        $zip.Dispose();" ^
    "    }" ^
    "} finally {" ^
    "    $stream.Dispose();" ^
    "}"

if %ERRORLEVEL% NEQ 0 (
    echo zip failed with exit code %ERRORLEVEL%.
    exit /b %ERRORLEVEL%
)
exit /b 0

rem ----------------------------------------------------------------
rem  Tool lookup: PATH first, then Git for Windows installs
rem ----------------------------------------------------------------
:locate_brotli
if defined BROTLI exit /b 0
if exist "%ProgramFiles%\Git\mingw64\bin\brotli.exe" set "BROTLI=%ProgramFiles%\Git\mingw64\bin\brotli.exe"
if defined BROTLI exit /b 0
if exist "%ProgramFiles%\Git\usr\bin\brotli.exe" set "BROTLI=%ProgramFiles%\Git\usr\bin\brotli.exe"
if defined BROTLI exit /b 0
if exist "%ProgramFiles(x86)%\Git\mingw64\bin\brotli.exe" set "BROTLI=%ProgramFiles(x86)%\Git\mingw64\bin\brotli.exe"
if defined BROTLI exit /b 0
if exist "%ProgramFiles(x86)%\Git\usr\bin\brotli.exe" set "BROTLI=%ProgramFiles(x86)%\Git\usr\bin\brotli.exe"
if defined BROTLI exit /b 0
if exist "%LocalAppData%\Programs\Git\mingw64\bin\brotli.exe" set "BROTLI=%LocalAppData%\Programs\Git\mingw64\bin\brotli.exe"
if defined BROTLI exit /b 0
if exist "%LocalAppData%\Programs\Git\usr\bin\brotli.exe" set "BROTLI=%LocalAppData%\Programs\Git\usr\bin\brotli.exe"
if defined BROTLI exit /b 0
if exist "D:\corestu\Git\mingw64\bin\brotli.exe" set "BROTLI=D:\corestu\Git\mingw64\bin\brotli.exe"
if defined BROTLI exit /b 0
if exist "D:\corestu\Git\usr\bin\brotli.exe" set "BROTLI=D:\corestu\Git\usr\bin\brotli.exe"
exit /b 0

:locate_gzip
if defined GZIP exit /b 0
if exist "%ProgramFiles%\Git\mingw64\bin\gzip.exe" set "GZIP=%ProgramFiles%\Git\mingw64\bin\gzip.exe"
if defined GZIP exit /b 0
if exist "%ProgramFiles%\Git\usr\bin\gzip.exe" set "GZIP=%ProgramFiles%\Git\usr\bin\gzip.exe"
if defined GZIP exit /b 0
if exist "%ProgramFiles(x86)%\Git\mingw64\bin\gzip.exe" set "GZIP=%ProgramFiles(x86)%\Git\mingw64\bin\gzip.exe"
if defined GZIP exit /b 0
if exist "%ProgramFiles(x86)%\Git\usr\bin\gzip.exe" set "GZIP=%ProgramFiles(x86)%\Git\usr\bin\gzip.exe"
if defined GZIP exit /b 0
if exist "%LocalAppData%\Programs\Git\mingw64\bin\gzip.exe" set "GZIP=%LocalAppData%\Programs\Git\mingw64\bin\gzip.exe"
if defined GZIP exit /b 0
if exist "%LocalAppData%\Programs\Git\usr\bin\gzip.exe" set "GZIP=%LocalAppData%\Programs\Git\usr\bin\gzip.exe"
if defined GZIP exit /b 0
if exist "D:\corestu\Git\mingw64\bin\gzip.exe" set "GZIP=D:\corestu\Git\mingw64\bin\gzip.exe"
if defined GZIP exit /b 0
if exist "D:\corestu\Git\usr\bin\gzip.exe" set "GZIP=D:\corestu\Git\usr\bin\gzip.exe"
exit /b 0

rem ----------------------------------------------------------------
rem  Cleanup helpers
rem ----------------------------------------------------------------
:purge_dir
if not exist "%~1" exit /b 0
set "PURGE_DIR=%~1"
attrib -r -h -s "%PURGE_DIR%\*" /s /d >nul 2>nul
rmdir /s /q "%PURGE_DIR%" >nul 2>nul
if not exist "%PURGE_DIR%" exit /b 0
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$p = $env:PURGE_DIR;" ^
    "if ([System.IO.Directory]::Exists($p)) { [System.IO.Directory]::Delete($p, $true) }" >nul 2>nul
set "PURGE_DIR="
if exist "%~1" goto :purge_dir_failed
exit /b 0

:purge_dir_failed
echo Failed to remove directory: %~1
exit /b 1

:purge_pattern
if not exist "%~1" exit /b 0
set "PURGE_ROOT=%~1"
set "PURGE_GLOB=%~2"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$root = $env:PURGE_ROOT; $glob = $env:PURGE_GLOB;" ^
    "Get-ChildItem -LiteralPath $root -Recurse -File -Filter $glob | ForEach-Object { [System.IO.File]::Delete($_.FullName) }"
set "PURGE_ROOT="
set "PURGE_GLOB="
exit /b 0

:cleanup_error
call :purge_dir "%STAGE_ROOT%"
endlocal
exit /b 1
