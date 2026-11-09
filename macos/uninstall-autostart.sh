#!/bin/bash
set -e

LABEL="app.velarium.cinema"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"

if [ -f "${PLIST_PATH}" ]; then
  launchctl unload "${PLIST_PATH}" >/dev/null 2>&1 || true
  rm -f "${PLIST_PATH}"
  echo "Velarium LaunchAgent удален: ${PLIST_PATH}"
else
  echo "Velarium LaunchAgent не был установлен."
fi
