#!/bin/bash
set -e

SERVER_ID="$1"

BASE="/opt/gameforge/library/games/cs2/steamcmd/latest/game"
SERVER="/opt/gameforge/servers/$SERVER_ID"

UPPER="$SERVER/overlay/upper"
WORK="$SERVER/overlay/work"
MERGED="$SERVER/files/game"

if [ -z "$SERVER_ID" ]; then
  echo "Uso: mount-cs2-overlay.sh <SERVER_ID>"
  exit 1
fi

echo ">> Preparar overlay para $SERVER_ID"

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

mkdir -p "$MERGED/csgo/addons"
mkdir -p "$MERGED/csgo/cfg"

echo ">> Overlay montado com sucesso"
