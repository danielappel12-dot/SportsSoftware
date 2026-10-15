@echo off
REM Development mode (Windows): API with auto-reload on :8000 and Vite hot-reload UI on :5173
setlocal
cd /d "%~dp0\.."
if not exist .venv (python -m venv .venv || exit /b 1)
call .venv\Scripts\activate.bat
pip install --quiet -r backend\requirements-dev.txt || exit /b 1
if not exist frontend\node_modules (pushd frontend & call npm install --no-audit --no-fund & popd)
start "Sideline API" cmd /k "cd backend && ..\.venv\Scripts\python -m uvicorn sideline.main:app --reload --host 127.0.0.1 --port 8000"
cd frontend
echo UI: http://127.0.0.1:5173
call npm run dev -- --host 127.0.0.1
