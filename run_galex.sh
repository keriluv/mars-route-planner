#!/usr/bin/env bash
set -e

# =========================================================
# GaleX — Predictive route planner for Mars
# Quick-start script (Linux / macOS) — Offline-First Web
# =========================================================

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "========================================================="
echo "  GaleX — NASA Space Apps Challenge (Mars)"
echo "  Starting local server and opening the web interface..."
echo "========================================================="

# Check for Python 3
if ! command -v python3 &>/dev/null; then
  echo "Error: python3 is not installed or not found in PATH."
  exit 1
fi

# Start the server in the background
python3 backend/server.py &
PID=$!

trap "kill $PID 2>/dev/null || true" EXIT

# Wait for the server to respond
for i in {1..10}; do
  if curl -s http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

URL="http://127.0.0.1:8000/"
echo "Server running at: $URL"
echo "Opening browser..."

if command -v xdg-open &>/dev/null; then
  xdg-open "$URL" >/dev/null 2>&1 || true
elif command -v sensible-browser &>/dev/null; then
  sensible-browser "$URL" >/dev/null 2>&1 || true
elif command -v open &>/dev/null; then
  open "$URL" >/dev/null 2>&1 || true
else
  echo "Please open in your browser: $URL"
fi

echo "Press Ctrl+C to stop the server."
wait $PID
