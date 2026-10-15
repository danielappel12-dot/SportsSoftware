@echo off
REM One command for everyday use (Windows): venv + dependencies + UI build + start on http://127.0.0.1:8000
setlocal
cd /d "%~dp0\.."
where python >nul 2>nul || (echo Python 3.10 - 3.13 is required: https://www.python.org/downloads/ & exit /b 1)
if not exist .venv (python -m venv .venv || exit /b 1)
call .venv\Scripts\activate.bat
python -m pip install --quiet --upgrade pip
pip install --quiet -r backend\requirements.txt || exit /b 1
pip install --quiet -r backend\requirements-raw.txt 2>nul || echo (optional RAW support not installed - see README)
if not exist frontend\dist\index.html (
  where npm >nul 2>nul || (echo Node.js 18+ is required to build the UI: https://nodejs.org & exit /b 1)
  pushd frontend
  call npm ci --no-audit --no-fund || exit /b 1
  call npm run build || exit /b 1
  popd
)
cd backend
echo Sideline Select AI: http://127.0.0.1:8000
python -m sideline.main
