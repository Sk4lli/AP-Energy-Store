#!/bin/sh
# Starts a local web server and opens the store in the browser.
# The page cannot be opened as a plain file (file://): browsers block JavaScript modules there.
set -e
cd "$(dirname "$0")"

PORT="${PORT:-3000}"
URL="http://localhost:${PORT}/index.html"

echo "Energylink Store -> ${URL}"
echo "Beenden mit Strg+C"

# open the browser a moment later, once the server is up
( sleep 1
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "${URL}" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then open "${URL}" >/dev/null 2>&1 || true
  fi ) &

if command -v python3 >/dev/null 2>&1; then
    exec python3 -m http.server "${PORT}"
elif command -v python >/dev/null 2>&1; then
    exec python -m SimpleHTTPServer "${PORT}"
elif command -v npx >/dev/null 2>&1; then
    exec npx --yes http-server -p "${PORT}" -c-1
else
    echo "Kein python3, python oder npx gefunden. Bitte einen der beiden installieren." >&2
    exit 1
fi
