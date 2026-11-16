#!/bin/bash
# Doppelklick startet das WDF*IDF-Tool und öffnet es im Browser.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js wurde nicht gefunden. Bitte zuerst von https://nodejs.org installieren (LTS-Version)."
  read -n 1 -s -r -p "Taste drücken zum Schließen …"
  exit 1
fi
( sleep 1; open "http://localhost:8787" ) &
node server.mjs
