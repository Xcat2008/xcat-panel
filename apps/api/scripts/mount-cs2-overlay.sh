#!/bin/bash
set -e

SERVER_ID="$1"
SERVER_PATH="${2:-}"

ROOT="${GAMEFORGE_ROOT:-/opt/xcat-panel}"
BASE="$ROOT/library/games/cs2/steamcmd/latest"
SERVER="${SERVER_PATH:-$ROOT/servers/$SERVER_ID}"

UPPER="$SERVER/overlay/upper"
WORK="$SERVER/overlay/work"
MERGED="$SERVER/files/game"

if [ -z "$SERVER_ID" ]; then
  echo "Uso: mount-cs2-overlay.sh <SERVER_ID>"
  exit 1
fi

echo ">> Preparar overlay para $SERVER_ID"

if [ ! -d "$BASE" ]; then
  echo ">> Biblioteca CS2 global nao encontrada em $BASE. Overlay ignorado; o start.sh pode instalar o jogo localmente."
  exit 0
fi

mkdir -p "$UPPER"
mkdir -p "$WORK"

if mountpoint -q "$MERGED"; then
  umount -l "$MERGED"
fi

rm -rf "$MERGED"
mkdir -p "$MERGED"

echo ">> Mount overlay..."

mount -t overlay overlay \
  -o lowerdir="$BASE",upperdir="$UPPER",workdir="$WORK" \
  "$MERGED"

mkdir -p "$MERGED/game/csgo/addons"
mkdir -p "$MERGED/game/csgo/cfg"

echo ">> Overlay montado com sucesso"
