@echo off
rem =========================================================
rem GaleX — Predictive route planner for Mars
rem Quick-start script (Windows) — Offline-First Web
rem =========================================================

echo =========================================================
echo   GaleX — NASA Space Apps Challenge (Mars)
echo   Starting local server and opening the web interface...
echo =========================================================

cd /d "%~dp0"

start /b python backend\server.py

timeout /t 2 /nobreak >nul

start http://127.0.0.1:8000/

echo.
echo Server running at http://127.0.0.1:8000/
echo To stop the server, close this window.
pause
