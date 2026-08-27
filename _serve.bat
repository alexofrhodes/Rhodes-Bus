@echo off
cd /d "%~dp0"

where python >nul 2>&1
if errorlevel 1 (
    echo Python was not found on PATH.
    echo Install Python or add it to PATH, then run this again.
    pause
    exit /b 1
)

set PORT=8081
start "" "http://127.0.0.1:%PORT%/"
echo Serving Standalone-Bus at http://127.0.0.1:%PORT%/
echo Close this window or press Ctrl+C to stop.
python -m http.server %PORT%