#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -f "$ROOT/.tauri-backend.pid" ]; then
  kill "$(cat "$ROOT/.tauri-backend.pid")" 2>/dev/null || true
  rm -f "$ROOT/.tauri-backend.pid"
  echo "[stop-backend] done"
else
  echo "[stop-backend] no pid file"
fi
