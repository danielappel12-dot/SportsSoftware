#!/usr/bin/env bash
# Development mode (macOS / Linux): FastAPI with auto-reload on :8000 + Vite dev server with hot reload on :5173
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PY="${PYTHON:-python3}"
[ -d .venv ] || "$PY" -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet -r backend/requirements-dev.txt
[ -d frontend/node_modules ] || (cd frontend && npm install --no-audit --no-fund)
trap 'kill 0' EXIT INT TERM
(cd backend && python -m uvicorn sideline.main:app --reload --host 127.0.0.1 --port "${SIDELINE_PORT:-8000}") &
(cd frontend && npm run dev -- --host 127.0.0.1) &
echo "→ UI: http://127.0.0.1:5173   API: http://127.0.0.1:${SIDELINE_PORT:-8000}/docs"
wait
