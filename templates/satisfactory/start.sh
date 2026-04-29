#!/usr/bin/env bash
set -Eeuo pipefail

: "${SERVER_PATH:?SERVER_PATH em falta}"
: "${LOG_PATH:?LOG_PATH em falta}"

GAME_PATH="${GAME_PATH:-$SERVER_PATH/files/game}"
PORT="${PORT:-7777}"
BEACON_PORT="${BEACON_PORT:-15000}"
QUERY_PORT="${QUERY_PORT:-15777}"

SERVER_BIN="$GAME_PATH/FactoryServer.sh"
PID_FILE="$SERVER_PATH/status.pid"

if [ ! -x "$SERVER_BIN" ]; then
  echo "[start] FactoryServer.sh nao encontrado ou sem permissao em $SERVER_BIN" >> "$LOG_PATH"
  exit 1
fi

{
  echo "[start] A iniciar Satisfactory"
  echo "[start] Portas: game=$PORT beacon=$BEACON_PORT query=$QUERY_PORT"
  cd "$GAME_PATH"
  nohup "$SERVER_BIN" -Port="$PORT" -BeaconPort="$BEACON_PORT" -QueryPort="$QUERY_PORT" -log >> "$LOG_PATH" 2>&1 &
  echo $! > "$PID_FILE"
  sleep 5
  if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "[start] O processo saiu logo apos arrancar"
    exit 1
  fi
  echo "[start] Online com PID $(cat "$PID_FILE")"
} >> "$LOG_PATH" 2>&1

