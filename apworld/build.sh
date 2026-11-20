#!/bin/sh
# Packt apworld/energylink_store zu apworld/energylink_store.apworld (Zip mit Ordner gleichen Namens).
set -e
cd "$(dirname "$0")"
rm -f energylink_store.apworld
find energylink_store -name "__pycache__" -prune -exec rm -rf {} + 2>/dev/null || true
zip -r -q energylink_store.apworld energylink_store -x "*__pycache__*" "*.pyc"
echo "built $(pwd)/energylink_store.apworld"
