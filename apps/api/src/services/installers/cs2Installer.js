import fs from 'fs/promises';
import path from 'path';

const ROOT = process.env.GAMEFORGE_ROOT || '/opt/gameforge';
const CS2_LIBRARY_PATH = path.join(ROOT, 'library', 'games', 'cs2', 'steamcmd', 'latest');

export async function installCS2Server(server, installConfig = {}) {
  const filesDir = path.join(server.path, 'files');

  await fs.access(CS2_LIBRARY_PATH);

  await fs.rm(filesDir, { recursive: true, force: true });
  await fs.mkdir(filesDir, { recursive: true });

  await fs.symlink(CS2_LIBRARY_PATH, path.join(filesDir, 'game'));

  const startScript = `#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

LOG_FILE="./server.log"
GAME_ROOT="$(readlink -f ./game)"
SERVER_ROOT="$(readlink -f ..)"
RUNTIME_FILE="$SERVER_ROOT/runtime.json"

read_runtime_value() {
  local key="$1"
  local fallback="$2"

  if [ -f "$RUNTIME_FILE" ] && command -v jq >/dev/null 2>&1; then
    jq -r --arg key "$key" --arg fallback "$fallback" '.[$key] // $fallback' "$RUNTIME_FILE"
  else
    echo "$fallback"
  fi
}

PORT="$(read_runtime_value port 27015)"
MAP="$(read_runtime_value map de_dust2)"
TICKRATE="$(read_runtime_value tickrate 128)"
MAXPLAYERS="$(read_runtime_value maxplayers 12)"
GAME_TYPE="$(read_runtime_value game_type 0)"
GAME_MODE="$(read_runtime_value game_mode 1)"
SERVER_CFG="$(read_runtime_value servercfgfile server.cfg)"

echo "===== GAMEFORGE START $(date) =====" >> "$LOG_FILE"
echo "[RUNTIME] port=$PORT map=$MAP tickrate=$TICKRATE maxplayers=$MAXPLAYERS game_type=$GAME_TYPE game_mode=$GAME_MODE cfg=$SERVER_CFG" >> "$LOG_FILE"

export LD_LIBRARY_PATH="$GAME_ROOT/game/bin/linuxsteamrt64:$GAME_ROOT/game/csgo/bin/linuxsteamrt64:$GAME_ROOT/game/bin/linuxsteamrt64/steamrt:\${LD_LIBRARY_PATH:-}"

while true; do
  echo "[WATCHDOG] Launching CS2 $(date)" >> "$LOG_FILE"

  "$GAME_ROOT/game/bin/linuxsteamrt64/cs2" \\
    -dedicated \\
    -usercon \\
    -console \\
    -port "$PORT" \\
    -tickrate "$TICKRATE" \\
    +map "$MAP" \\
    +game_type "$GAME_TYPE" \\
    +game_mode "$GAME_MODE" \\
    +maxplayers "$MAXPLAYERS" \\
    +servercfgfile "$SERVER_CFG" \\
    +exec "$SERVER_CFG" \\
    >> "$LOG_FILE" 2>&1

  echo "[CRASH] CS2 stopped/crashed, restarting in 5s..." >> "$LOG_FILE"
  sleep 5
done
`;

  await fs.writeFile(path.join(filesDir, 'start.sh'), startScript);
  await fs.chmod(path.join(filesDir, 'start.sh'), 0o755);

  await fs.writeFile(path.join(filesDir, 'GAMEFORGE-CS2-INSTALL.json'), JSON.stringify({
    game: 'cs2',
    type: 'symlink',
    library: CS2_LIBRARY_PATH,
    binary: 'game/bin/linuxsteamrt64/cs2',
    installedAt: new Date().toISOString(),
    dynamicRuntime: true,
    configPath: path.join(server.path, 'overlay/upper/csgo/cfg/server.cfg'),
    runtimePath: path.join(server.path, 'runtime.json'),
    installConfig
  }, null, 2));

  return {
    ok: true,
    filesDir
  };
}
