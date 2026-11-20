@echo off
REM Starts a local web server and opens the store in the browser.
REM The page cannot be opened as a plain file (file://): browsers block JavaScript modules there.
setlocal
cd /d "%~dp0"

if "%PORT%"=="" set PORT=3000
set URL=http://localhost:%PORT%/index.html

echo Energylink Store -^> %URL%
echo Beenden mit Strg+C

start "" "%URL%"

where python >nul 2>nul
if %errorlevel%==0 (
    python -m http.server %PORT%
    goto :eof
)

where py >nul 2>nul
if %errorlevel%==0 (
    py -m http.server %PORT%
    goto :eof
)

where npx >nul 2>nul
if %errorlevel%==0 (
    npx --yes http-server -p %PORT% -c-1
    goto :eof
)

echo Kein python, py oder npx gefunden. Bitte Python installieren.
pause
