#!/bin/bash
set -e

SERVER_ID="$1"
SERVER_PATH="/opt/gameforge/servers/$SERVER_ID"
LIB_ROOT="/opt/gameforge/library/games/cs2/steamcmd/latest"

if [ -z "$SERVER_ID" ]; then
  echo "Uso: isolate-cs2-server.sh <SERVER_ID>"
  exit 1
fi

echo ">> A isolar servidor $SERVER_ID"

PID_FILE="$SERVER_PATH/server.pid"

if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE" || true)"
  if [ -n "$PID" ]; then
    kill -TERM "-$PID" 2>/dev/null || kill -TERM "$PID" 2>/dev/null || true
    sleep 3
    kill -KILL "-$PID" 2>/dev/null || kill -KILL "$PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
fi

pkill -f "$SERVER_PATH/files/start.sh" 2>/dev/null || true
sleep 1

if [ -L "$SERVER_PATH/files/game" ]; then
  rm -f "$SERVER_PATH/files/game"
else
  rm -rf "$SERVER_PATH/files/game"
fi

echo ">> A copiar CS2 isolado..."
mkdir -p "$SERVER_PATH/files/game"
cp -a "$LIB_ROOT/." "$SERVER_PATH/files/game/"

mkdir -p "$SERVER_PATH/files/game/game/csgo/addons"

echo ">> Servidor isolado com sucesso"
