#!/usr/bin/env bash
set -Eeuo pipefail

: "${SERVER_PATH:?SERVER_PATH em falta}"
: "${LOG_PATH:?LOG_PATH em falta}"

PID_FILE="$SERVER_PATH/status.pid"

{
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "[stop] A parar PID $(cat "$PID_FILE")"
    kill "$(cat "$PID_FILE")"
    sleep 3
  fi
  rm -f "$PID_FILE"
  echo "[stop] Parado"
} >> "$LOG_PATH" 2>&1

