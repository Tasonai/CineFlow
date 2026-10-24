#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PORT="${PORT:-8765}"
URL="http://127.0.0.1:${PORT}"

if curl -fsS "${URL}/api/system/status" >/dev/null 2>&1 || lsof -iTCP:"${PORT}" -sTCP:LISTEN -t >/dev/null 2>&1; then
  open "${URL}"
  exit 0
fi

mkdir -p "${PROJECT_DIR}/data"
nohup /usr/bin/env python3 "${PROJECT_DIR}/server.py" >>"${PROJECT_DIR}/data/cineflow-launchd.log" 2>&1 &

for _ in {1..30}; do
  if lsof -iTCP:"${PORT}" -sTCP:LISTEN -t >/dev/null 2>&1; then
    break
  fi
  sleep 0.15
done

open "${URL}"
