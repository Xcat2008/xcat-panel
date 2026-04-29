import fs from 'fs/promises';
import path from 'path';

const ROOT = process.env.GAMEFORGE_ROOT || '/opt/xcat-panel';
const CS2_LIBRARY_PATH = path.join(ROOT, 'library', 'games', 'cs2', 'steamcmd', 'latest');
const CS2_APP_ID = '730';

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function installCS2Server(server, installConfig = {}) {
  const filesDir = path.join(server.path, 'files');
  const gameDir = path.join(filesDir, 'game');
  const hasSharedLibrary = await pathExists(CS2_LIBRARY_PATH);

  await fs.rm(filesDir, { recursive: true, force: true });
  await fs.mkdir(filesDir, { recursive: true });

  if (hasSharedLibrary) {
    await fs.symlink(CS2_LIBRARY_PATH, gameDir, 'dir');
  } else {
    await fs.mkdir(gameDir, { recursive: true });
  }

  const startScript = `#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

LOG_FILE="./server.log"
SHARED_GAME_ROOT="${CS2_LIBRARY_PATH}"
CS2_APP_ID="${CS2_APP_ID}"

ensure_game_files() {
  if [ -x "./game/game/bin/linuxsteamrt64/cs2" ]; then
    return 0
  fi

  if [ -x "$SHARED_GAME_ROOT/game/bin/linuxsteamrt64/cs2" ]; then
    rm -rf ./game
    ln -s "$SHARED_GAME_ROOT" ./game
    return 0
  fi

  if ! command -v steamcmd >/dev/null 2>&1; then
    echo "[ERROR] SteamCMD nao esta instalado. Instala steamcmd ou cria a biblioteca em $SHARED_GAME_ROOT." >> "$LOG_FILE"
    exit 127
  fi

  mkdir -p ./game
  echo "[INSTALL] Biblioteca CS2 em falta. A descarregar app $CS2_APP_ID para $(readlink -f ./game)..." >> "$LOG_FILE"
  steamcmd +force_install_dir "$(readlink -f ./game)" +login anonymous +app_update "$CS2_APP_ID" validate +quit >> "$LOG_FILE" 2>&1

  if [ ! -x "./game/game/bin/linuxsteamrt64/cs2" ]; then
    echo "[ERROR] SteamCMD terminou, mas o binario CS2 nao foi encontrado." >> "$LOG_FILE"
    exit 127
  fi
}

ensure_game_files

GAME_ROOT="$(readlink -f ./game)"
SERVER_ROOT="$(readlink -f ..)"
RUNTIME_FILE="$SERVER_ROOT/runtime.json"
GENERATED_CFG="$SERVER_ROOT/overlay/upper/csgo/cfg/server.cfg"

if [ -f "$GENERATED_CFG" ]; then
  mkdir -p "$GAME_ROOT/game/csgo/cfg"
  cp "$GENERATED_CFG" "$GAME_ROOT/game/csgo/cfg/server.cfg"
fi

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
    type: hasSharedLibrary ? 'symlink' : 'local-steamcmd',
    library: CS2_LIBRARY_PATH,
    steamAppId: CS2_APP_ID,
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
