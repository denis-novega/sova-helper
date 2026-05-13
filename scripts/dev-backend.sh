#!/usr/bin/env bash
set -euo pipefail

# Определяем корень проекта
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# === Активация виртуального окружения ===
if [ -f "$ROOT/.venv/bin/activate" ]; then
  # shellcheck disable=SC1091
  source "$ROOT/.venv/bin/activate"
fi

# === Переменные окружения ===
export PYTHONUNBUFFERED=1
export OPENAI_API_KEY="${OPENAI_API_KEY:-}"
PORT=7861

# === Проверка порта ===
if lsof -Pi :"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "[dev-backend] port $PORT already in use — reusing existing FastAPI server"
  # Чтобы concurrently/Tauri не ждали завершения, просто висим в фоне
  # до тех пор, пока порт снова не освободится
  while lsof -Pi :"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; do
    sleep 2
  done
  exit 0
fi

# === Запуск uvicorn ===
echo "[dev-backend] starting uvicorn on 127.0.0.1:$PORT"
exec uvicorn engine.app:app \
  --host 127.0.0.1 \
  --port "$PORT" \
  --reload \
  --log-level info
