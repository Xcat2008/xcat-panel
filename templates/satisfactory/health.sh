#!/usr/bin/env bash
set -Eeuo pipefail

: "${SERVER_PATH:?SERVER_PATH em falta}"

PID_FILE="$SERVER_PATH/status.pid"

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  exit 0
fi

exit 1

