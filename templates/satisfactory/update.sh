#!/usr/bin/env bash
set -Eeuo pipefail

: "${SERVER_PATH:?SERVER_PATH em falta}"
: "${LOG_PATH:?LOG_PATH em falta}"

GAME_PATH="${GAME_PATH:-$SERVER_PATH/files/game}"
mkdir -p "$GAME_PATH"

{
  echo "[update] A atualizar Satisfactory"
  steamcmd +force_install_dir "$GAME_PATH" +login anonymous +app_update 1690800 validate +quit
  echo "[update] Concluido"
} >> "$LOG_PATH" 2>&1

