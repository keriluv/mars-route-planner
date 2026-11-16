@echo off
rem =========================================================
rem GaleX — Planificador predictivo de recorridos en Marte
rem Script de inicio rápido (Windows) — Web Offline-First
rem =========================================================

echo =========================================================
echo   GaleX — NASA Space Apps Challenge (Marte)
echo   Iniciando servidor local y abriendo interfaz web...
echo =========================================================

cd /d "%~dp0"

if exist ".venv\Scripts\python.exe" (
  start /b "" ".venv\Scripts\python.exe" backend\server.py
) else (
  start /b "" python backend\server.py
)

timeout /t 2 /nobreak >nul

start http://127.0.0.1:8000/

echo.
echo Servidor activo en http://127.0.0.1:8000/
echo Para detener el servidor, cierra esta ventana.
pause
