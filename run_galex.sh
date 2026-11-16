#!/usr/bin/env bash
set -e

# =========================================================
# GaleX — Planificador predictivo de recorridos en Marte
# Script de inicio rápido (Linux / macOS) — Web Offline-First
# =========================================================

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "========================================================="
echo "  GaleX — NASA Space Apps Challenge (Marte)"
echo "  Iniciando servidor local y abriendo interfaz web..."
echo "========================================================="

# Verificar Python 3
if ! command -v python3 &>/dev/null; then
  echo "Error: python3 no está instalado o no se encuentra en el PATH."
  exit 1
fi

# Si el puerto 8000 ya está ocupado por una instancia previa, liberarlo limpiamente
OLD_PID=$(lsof -ti :8000 2>/dev/null || true)
if [ -n "$OLD_PID" ]; then
  echo "Liberando puerto 8000 (proceso previo detectado en PID $OLD_PID)..."
  kill $OLD_PID 2>/dev/null || true
  sleep 0.5
fi

# Iniciar servidor en segundo plano
python3 backend/server.py &
PID=$!

trap "kill $PID 2>/dev/null || true" EXIT

# Esperar a que el servidor responda
for i in {1..10}; do
  if curl -s http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

URL="http://127.0.0.1:8000/"
echo "Servidor activo en: $URL"
echo "Abriendo navegador..."

if command -v xdg-open &>/dev/null; then
  xdg-open "$URL" >/dev/null 2>&1 || true
elif command -v sensible-browser &>/dev/null; then
  sensible-browser "$URL" >/dev/null 2>&1 || true
elif command -v open &>/dev/null; then
  open "$URL" >/dev/null 2>&1 || true
else
  echo "Por favor abre en tu navegador: $URL"
fi

echo "Presiona Ctrl+C para detener el servidor."
wait $PID
