#!/usr/bin/env bash
# One command for everyday use (macOS / Linux): creates the virtualenv, installs dependencies, builds the UI
# and starts Sideline Select AI on http://127.0.0.1:8000
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PY="${PYTHON:-python3}"
command -v "$PY" >/dev/null || { echo "Python 3.10+ is required (https://www.python.org/downloads/)"; exit 1; }
"$PY" -c 'import sys; sys.exit(0 if (3,10) <= sys.version_info[:2] <= (3,13) else 1)' || { echo "Python 3.10 – 3.13 required (found $($PY --version))"; exit 1; }
[ -d .venv ] || "$PY" -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet -r backend/requirements.txt
[ -f backend/requirements-raw.txt ] && pip install --quiet -r backend/requirements-raw.txt 2>/dev/null || echo "(optional RAW support not installed – see README)"
if [ ! -f frontend/dist/index.html ] || [ -n "$(find frontend/src -newer frontend/dist/index.html -print -quit 2>/dev/null)" ]; then
  command -v npm >/dev/null || { echo "Node.js 18+ is required to build the UI (https://nodejs.org)"; exit 1; }
  (cd frontend && npm ci --no-audit --no-fund && npm run build)
fi
cd backend
echo "→ Sideline Select AI: http://127.0.0.1:${SIDELINE_PORT:-8000}"
exec python -m sideline.main
