import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import gameModes from '../data/gameModes.js';
import { listPlugins } from './pluginService.js';
import { getModeMaps } from './gameModeMapsService.js';

const execFileAsync = promisify(execFile);
const SERVERS_ROOT = '/opt/gameforge/servers';

function serverRoot(serverId) {
  return path.join(SERVERS_ROOT, serverId);
}

function csgoRoot(serverId) {
  return path.join(serverRoot(serverId), 'files/game/csgo');
}

function statePath(serverId) {
  return path.join(serverRoot(serverId), 'game-mode.json');
}

function runtimePath(serverId) {
  return path.join(serverRoot(serverId), 'runtime.json');
}

function configPath(serverId) {
  return path.join(serverRoot(serverId), 'config.json');
}

function consolePipePath(serverId) {
  return path.join(serverRoot(serverId), 'files/console.pipe');
}

function matchZyPath(serverId) {
  return path.join(csgoRoot(serverId), 'addons/counterstrikesharp/plugins/MatchZy');
}

function matchZyDisabledPath(serverId) {
  return path.join(csgoRoot(serverId), 'addons/counterstrikesharp/plugins/MatchZy.disabled');
}

const CSS_PLUGIN_FOLDERS = {
  gungame: ['GunGame', 'GunGame2', 'GG2'],
  retakes: ['Retakes', 'RetakesPlugin']
};

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file, fallback = {}) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function shuffle(items) {
  const output = [...items];

  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [output[index], output[swapIndex]] = [output[swapIndex], output[index]];
  }

  return output;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendPipeCommand(serverId, command) {
  const pipe = consolePipePath(serverId);

  if (!(await exists(pipe))) {
    throw new Error(`console.pipe não existe em ${pipe}`);
  }

  await execFileAsync(
    'timeout',
    ['5', 'bash', '-lc', 'printf "%s\n" "$1" > "$2"', 'gameforge-mode', command, pipe],
    { timeout: 7000 }
  );
}

async function waitForPipe(serverId, timeoutMs = 45000) {
  const pipe = consolePipePath(serverId);
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await exists(pipe)) return true;
    await sleep(1000);
  }

  return false;
}

async function restartCs2Safe(serverId) {
  const root = serverRoot(serverId);
  const filesDir = path.join(root, 'files');
  const startScript = path.join(filesDir, 'start.sh');

  if (!(await exists(startScript))) {
    throw new Error(`start.sh não encontrado em ${startScript}`);
  }

  // MUITO IMPORTANTE:
  // Não usar pkill/pgrep com o caminho completo dentro do próprio bash,
  // porque pode matar este próprio comando.
  await execFileAsync(
    'bash',
    ['-lc', `
      set +e

      echo "[GAMEFORGE] safe restart requested $(date)" >> "${filesDir}/server.log"

      PIDS=$(ps ax -o pid= -o args= | grep "${root}/files/game/bin/linuxsteamrt64/cs2" | grep -v grep | awk '{print $1}')

      if [ -n "$PIDS" ]; then
        echo "$PIDS" | while read -r pid; do
          kill "$pid" 2>/dev/null || true
        done
      fi

      sleep 8

      PIDS=$(ps ax -o pid= -o args= | grep "${root}/files/game/bin/linuxsteamrt64/cs2" | grep -v grep | awk '{print $1}')

      if [ -n "$PIDS" ]; then
        echo "$PIDS" | while read -r pid; do
          kill -9 "$pid" 2>/dev/null || true
        done
      fi

      sleep 5

      # Se o watchdog start.sh não estiver vivo, arranca-o.
      WATCHDOG=$(ps ax -o args= | grep "${filesDir}/start.sh" | grep -v grep || true)

      if [ -z "$WATCHDOG" ]; then
        cd "${filesDir}"
        nohup ./start.sh >> server.log 2>&1 &
      fi

      exit 0
    `],
    { timeout: 30000 }
  );

  const ready = await waitForPipe(serverId, 70000);

  if (!ready) {
    throw new Error('Servidor reiniciado, mas console.pipe não ficou disponível a tempo.');
  }

  await sleep(7000);
}

async function setMatchZyEnabled(serverId, enabled) {
  const active = matchZyPath(serverId);
  const disabled = matchZyDisabledPath(serverId);

  if (enabled) {
    if (await exists(active)) return false;

    if (await exists(disabled)) {
      await fs.rename(disabled, active);
      return true;
    }

    return false;
  }

  if (await exists(disabled)) return false;

  if (await exists(active)) {
    await fs.rename(active, disabled);
    return true;
  }

  return false;
}

function cssPluginPath(serverId, folder) {
  return path.join(csgoRoot(serverId), 'addons/counterstrikesharp/plugins', folder);
}

function cssPluginDisabledPath(serverId, folder) {
  return path.join(csgoRoot(serverId), 'addons/counterstrikesharp/plugins', `${folder}.disabled`);
}

async function setCssPluginEnabled(serverId, pluginId, enabled) {
  const folders = CSS_PLUGIN_FOLDERS[pluginId] || [];
  let changed = false;

  if (enabled) {
    for (const folder of folders) {
      const active = cssPluginPath(serverId, folder);
      const disabled = cssPluginDisabledPath(serverId, folder);

      if (await exists(active)) continue;

      if (await exists(disabled)) {
        await fs.rename(disabled, active);
        changed = true;
      }
    }

    return changed;
  }

  for (const folder of folders) {
    const active = cssPluginPath(serverId, folder);
    const disabled = cssPluginDisabledPath(serverId, folder);

    if ((await exists(active)) && !(await exists(disabled))) {
      await fs.rename(active, disabled);
      changed = true;
    }
  }

  return changed;
}

async function applyPluginProfile(serverId, mode) {
  if (!mode.pluginProfile) return false;

  let changed = false;

  if (typeof mode.pluginProfile.matchzy === 'boolean') {
    const didChange = await setMatchZyEnabled(serverId, mode.pluginProfile.matchzy);
    if (didChange) changed = true;
  }

  for (const pluginId of ['gungame', 'retakes']) {
    if (typeof mode.pluginProfile[pluginId] === 'boolean') {
      const didChange = await setCssPluginEnabled(serverId, pluginId, mode.pluginProfile[pluginId]);
      if (didChange) changed = true;
    }
  }

  return changed;
}

function defaultCfgs() {
  return {
    competitive: `
sv_cheats 0
bot_kick
mp_autoteambalance 0
mp_limitteams 0
mp_freezetime 15
mp_roundtime 1.92
mp_roundtime_defuse 1.92
mp_maxrounds 24
mp_overtime_enable 1
mp_startmoney 800
mp_buytime 20
mp_buy_anywhere 0
tv_enable 1
tv_maxclients 1
mp_warmup_end
mp_restartgame 1
`,
    aim: `
sv_cheats 0
bot_kick
mp_autoteambalance 0
mp_limitteams 0
mp_freezetime 0
mp_roundtime 60
mp_roundtime_defuse 60
mp_maxrounds 999
mp_startmoney 16000
mp_buytime 9999
mp_buy_anywhere 1
sv_infinite_ammo 1
ammo_grenade_limit_total 5
tv_enable 1
tv_maxclients 1
mp_warmup_end
mp_restartgame 1
`,
    fun: `
sv_cheats 0
bot_kick
mp_autoteambalance 1
mp_limitteams 2
mp_freezetime 3
mp_roundtime 3
mp_roundtime_defuse 3
mp_maxrounds 30
mp_startmoney 16000
mp_buytime 60
mp_buy_anywhere 0
sv_infinite_ammo 0
tv_enable 1
tv_maxclients 1
mp_warmup_end
mp_restartgame 1
`,
    gungame: `
sv_cheats 0
bot_kick
mp_autoteambalance 0
mp_limitteams 0
mp_freezetime 2
mp_roundtime 60
mp_roundtime_defuse 0
mp_roundtime_hostage 0
mp_maxrounds 999
mp_timelimit 45
mp_ignore_round_win_conditions 1
mp_respawn_on_death_ct 1
mp_respawn_on_death_t 1
mp_respawn_immunitytime 0
mp_teammates_are_enemies 1
mp_forcecamera 0
mp_warmuptime 0
mp_warmup_end
mp_buy_anywhere 1
mp_startmoney 0
mp_buytime 0
mp_give_player_c4 0
mp_anyone_can_pickup_c4 0
mp_death_drop_gun 0
mp_death_drop_grenade 0
mp_death_drop_c4 0
mp_weapons_allow_map_placed 0
weapon_auto_cleanup_time 1
tv_enable 1
tv_maxclients 1
mp_restartgame 1
`,
    retakes: `
sv_cheats 0
bot_kick
mp_autoteambalance 0
mp_limitteams 0
mp_freezetime 2
mp_roundtime 1.92
mp_roundtime_defuse 1.92
mp_maxrounds 30
mp_startmoney 16000
mp_buytime 20
tv_enable 1
tv_maxclients 1
mp_warmup_end
mp_restartgame 1
`
  };
}

async function ensureModeCfgs(serverId, customMaps = {}) {
  const cfgDir = path.join(csgoRoot(serverId), 'cfg/GameForgeModes');
  await fs.mkdir(cfgDir, { recursive: true });

  const cfgs = defaultCfgs();

  for (const [modeId, content] of Object.entries(cfgs)) {
    const custom = customMaps[modeId];
    const baseContent = typeof custom?.configText === 'string' && custom.configText.trim()
      ? custom.configText
      : content;
    const botQuota = Number(custom?.settings?.botQuota ?? 0);
    const tvSlots = Number(custom?.settings?.tvSlots ?? 1);
    const rotationEnabled = custom?.rotation?.enabled !== false;
    const rotationMode = custom?.rotation?.mode || 'sequential';
    const mapPool = Array.isArray(custom?.mapPool) ? custom.mapPool : [];
    const normalMaps = mapPool.filter((map) => !String(map).startsWith('workshop:'));
    const rotationMaps = rotationMode === 'random' ? shuffle(normalMaps) : normalMaps;
    const cycleFileName = `${modeId}_mapcycle.txt`;
    const settingsContent = `
bot_quota ${Number.isFinite(botQuota) ? Math.max(0, botQuota) : 0}
tv_maxclients ${Number.isFinite(tvSlots) ? Math.max(0, tvSlots) : 1}
${rotationEnabled && rotationMaps.length ? `mapcyclefile "GameForgeModes/${cycleFileName}"\nmp_match_end_changelevel 1\nmp_match_end_restart 0` : ''}
`;
    const finalContent = `${baseContent.trim()}\n${settingsContent}`;

    await fs.writeFile(path.join(cfgDir, cycleFileName), `${rotationMaps.join('\n')}\n`, 'utf8');
    await fs.writeFile(path.join(cfgDir, `${modeId}.cfg`), finalContent.trimStart(), 'utf8');
  }
}

async function applyModeRuntime(serverId, mode, modeData = {}) {
  const desired = Number(modeData.settings?.maxPlayers || mode.defaultSettings?.maxPlayers || 0);
  const gameType = Number(modeData.settings?.gameType ?? mode.defaultSettings?.gameType ?? 0);
  const gameMode = Number(modeData.settings?.gameMode ?? mode.defaultSettings?.gameMode ?? 1);

  if (!Number.isFinite(desired) || desired < 1) {
    return false;
  }

  const runtime = await readJson(runtimePath(serverId), {});
  const config = await readJson(configPath(serverId), {});
  const current = Number(runtime.maxPlayers || runtime.maxplayers || config.installConfig?.maxPlayers || 0);
  const currentGameType = Number(runtime.game_type ?? 0);
  const currentGameMode = Number(runtime.game_mode ?? 1);
  const changed = current !== desired || currentGameType !== gameType || currentGameMode !== gameMode;

  runtime.maxPlayers = desired;
  runtime.maxplayers = desired;
  runtime.game_type = gameType;
  runtime.game_mode = gameMode;
  if (!runtime.map && modeData.defaultMap) runtime.map = modeData.defaultMap;

  config.installConfig = {
    ...(config.installConfig || {}),
    maxPlayers: desired
  };

  await writeJson(runtimePath(serverId), runtime);
  await writeJson(configPath(serverId), config);

  return changed;
}

async function tuneGunGameConfig(serverId) {
  const file = path.join(csgoRoot(serverId), 'cfg/gungame/gungame.json');

  if (!(await exists(file))) return false;

  const cfg = await readJson(file, null);
  if (!cfg || typeof cfg !== 'object') return false;

  Object.assign(cfg, {
    IsPluginEnabled: true,
    WarmupEnabled: false,
    WarmupTimeLength: 0,
    WarmupRandomWeaponMode: 0,
    WarmupNades: false,
    RestoreLevelOnReconnect: false,
    HandicapMode: 0,
    HandicapUpdate: 0,
    MinKillsPerLevel: 1,
    MultipleKillsPerLevel: {},
    MaxLevelPerRound: 0,
    RespawnByPlugin: 3,
    RemoveObjectives: 3,
    StripDeadPlayersWeapon: 1,
    TurboMode: true,
    FriendlyFireAllowed: true,
    AutoFriendlyFire: false,
    FriendlyFireOnOff: false,
    AllowLevelUpAfterRoundEnd: false,
    BotCanWin: false,
    AllowLevelUpByKnifeBotIfNoHuman: true,
    AllowLevelUpByExplodeBotIfNoHuman: true,
    EndGameDelay: 12,
    EndGameSilent: false
  });

  await writeJson(file, cfg);
  return true;
}

function mapCommand(map) {
  if (!map) return null;

  if (String(map).startsWith('workshop:')) {
    const workshopId = String(map).replace('workshop:', '').trim();
    return `host_workshop_map ${workshopId}`;
  }

  return `changelevel ${map}`;
}

export async function getGameModeState(serverId) {
  return readJson(statePath(serverId), {
    activeMode: 'unknown',
    activeModeName: '',
    updatedAt: null,
    history: []
  });
}

export async function listGameModes(serverId) {
  const state = await getGameModeState(serverId);
  const plugins = await listPlugins(serverId, 'cs2');

  return gameModes.map((mode) => {
    const requiredPlugin = mode.requiresPlugin
      ? plugins.find((plugin) => plugin.id === mode.requiresPlugin)
      : null;

    const pluginInstalled = mode.requiresPlugin ? Boolean(requiredPlugin?.installed) : true;
    const canApply = Boolean(mode.available && pluginInstalled);

    return {
      ...mode,
      active: state.activeMode === mode.id,
      requiredPluginInstalled: pluginInstalled,
      canApply,
      unavailableReason: canApply
        ? ''
        : mode.requiresPlugin
          ? `Requer plugin ${mode.requiresPlugin} instalado.`
          : 'Modo ainda não disponível.'
    };
  });
}

export async function applyGameMode(serverId, modeId) {
  const mode = gameModes.find((item) => item.id === modeId);

  if (!mode) {
    throw new Error('Modo de jogo não encontrado.');
  }

  const modes = await listGameModes(serverId);
  const runtimeMode = modes.find((item) => item.id === modeId);

  if (!runtimeMode?.canApply) {
    throw new Error(runtimeMode?.unavailableReason || 'Modo indisponível.');
  }

  const customMaps = await getModeMaps(serverId);
  await ensureModeCfgs(serverId, customMaps);

  const custom = customMaps[mode.id] || {};
  const runtimeChanged = await applyModeRuntime(serverId, mode, custom);

  const pluginProfileChanged = await applyPluginProfile(serverId, mode);

  if (mode.id === 'gungame') {
    await tuneGunGameConfig(serverId);
  }

  const shouldRestart = pluginProfileChanged || runtimeChanged || mode.id === 'gungame';

  if (shouldRestart) {
    await restartCs2Safe(serverId);
  }

  const finalMap = custom?.defaultMap || mode.defaultMap;
  const finalMapCommand = mapCommand(finalMap);

  const commandsToSend = mode.id === 'gungame'
    ? [
        ...(finalMapCommand ? [finalMapCommand] : []),
        ...(mode.commands || [])
      ]
    : [
        ...(mode.commands || []),
        ...(finalMapCommand ? [finalMapCommand] : [])
      ];

  for (const command of commandsToSend) {
    await sendPipeCommand(serverId, command);
    await sleep(mode.id === 'gungame' && (command.startsWith('changelevel') || command.startsWith('host_workshop_map')) ? 5000 : 500);
  }

  const state = await getGameModeState(serverId);
  const now = new Date().toISOString();

  const nextState = {
    activeMode: mode.id,
    activeModeName: mode.name,
    updatedAt: now,
    pluginProfileChanged,
    history: [
      {
        mode: mode.id,
        name: mode.name,
        appliedAt: now,
        pluginProfileChanged,
        runtimeChanged,
        commands: commandsToSend
      },
      ...(state.history || [])
    ].slice(0, 30)
  };

  await writeJson(statePath(serverId), nextState);

  return {
    ok: true,
    mode: mode.id,
    name: mode.name,
    pluginProfileChanged,
    runtimeChanged,
    restarted: shouldRestart,
    commands: commandsToSend,
    state: nextState
  };
}
