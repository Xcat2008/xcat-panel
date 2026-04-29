import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getCatalog } from './catalogService.js';
import { installCS2Server } from './installers/cs2Installer.js';
import { addActivity } from './activityService.js';
import { applyConfig, saveConfig } from './cs2ConfigService.js';
import { writeCs2Runtime } from './cs2RuntimeService.js';
import { startServerProcess, stopServerProcess, isServerProcessRunning } from './serverProcessService.js';
import { ensureCs2OverlayMounted } from './cs2OverlayService.js';
import { getStorageRoot, isPathInsideStorageRoots } from './storageService.js';

const ROOT = process.env.GAMEFORGE_ROOT || '/opt/xcat-panel';
const DATA_DIR = path.join(ROOT, 'data');
const SERVERS_DIR = path.join(ROOT, 'servers');
const LIBRARY_DIR = path.join(ROOT, 'library');
const SERVERS_FILE = path.join(DATA_DIR, 'servers.json');
const CS2_CONFIGS_FILE = path.join(ROOT, 'apps', 'api', 'data', 'cs2-configs.json');

const REINSTALL_COOLDOWN_DAYS = 7;
const execFileAsync = promisify(execFile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ensureBaseDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(SERVERS_DIR, { recursive: true });
  await fs.mkdir(path.join(LIBRARY_DIR, 'downloads'), { recursive: true });
  await fs.mkdir(path.join(LIBRARY_DIR, 'archives'), { recursive: true });
  await fs.mkdir(path.join(LIBRARY_DIR, 'games'), { recursive: true });
  await fs.mkdir(path.join(LIBRARY_DIR, 'manifests'), { recursive: true });
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

async function appendLog(serverPath, message) {
  const logFile = path.join(serverPath, 'logs', 'console.log');
  await fs.mkdir(path.dirname(logFile), { recursive: true });
  await fs.appendFile(logFile, `[${new Date().toISOString()}] ${message}\n`);
}


async function applyGameConfigIfSupported(server, reason = 'runtime') {
  if (!server || server.game !== 'cs2') return null;

  const result = await applyConfig(server.id);
  const runtime = await writeCs2Runtime(server);

  await appendLog(server.path, `Configuração CS2 aplicada automaticamente (${reason}): ${result.path}`);

  if (runtime?.path) {
    await appendLog(server.path, `Runtime CS2 atualizado automaticamente (${reason}): ${runtime.path}`);
  }

  return {
    config: result,
    runtime
  };
}

async function unmountServerFiles(serverPath) {
  const mountPath = path.join(serverPath, 'files', 'game');

  try {
    await execFileAsync('mountpoint', ['-q', mountPath]);
  } catch {
    return false;
  }

  try {
    await execFileAsync('umount', ['-l', mountPath], { timeout: 30000 });
    return true;
  } catch {
    await execFileAsync('sudo', ['umount', '-l', mountPath], { timeout: 30000 });
    return true;
  }
}

async function deleteCs2ConfigRecord(serverId) {
  try {
    const configs = await readJson(CS2_CONFIGS_FILE, {});

    if (!Object.prototype.hasOwnProperty.call(configs, serverId)) {
      return false;
    }

    delete configs[serverId];
    await writeJson(CS2_CONFIGS_FILE, configs);
    return true;
  } catch {
    return false;
  }
}

async function readServersIndex() {
  await ensureBaseDirs();
  return readJson(SERVERS_FILE, []);
}

async function writeServersIndex(servers) {
  await writeJson(SERVERS_FILE, servers);
}

function canAccessServer(server, user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return server.ownerId === user.id;
}

function buildDefaults(schema = []) {
  const values = {};
  for (const field of schema) values[field.key] = field.default ?? '';
  return values;
}

function validateInstallConfig(template, config) {
  const finalConfig = {
    ...buildDefaults(template.schema),
    ...config
  };

  for (const field of template.schema || []) {
    const value = finalConfig[field.key];

    if (field.required && (value === undefined || value === null || value === '')) {
      throw new Error(`Campo obrigatório em falta: ${field.label}`);
    }

    if (field.type === 'number') {
      const numberValue = Number(value);

      if (Number.isNaN(numberValue)) {
        throw new Error(`Campo numérico inválido: ${field.label}`);
      }

      if (field.min !== undefined && numberValue < field.min) {
        throw new Error(`${field.label} mínimo: ${field.min}`);
      }

      if (field.max !== undefined && numberValue > field.max) {
        throw new Error(`${field.label} máximo: ${field.max}`);
      }

      finalConfig[field.key] = numberValue;
    }
  }

  return finalConfig;
}

function escapeXml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildPorts(template, installConfig) {
  if (template.id === 'cs2') {
    return [
      { name: 'Game', port: Number(installConfig.port || 27015), protocol: 'udp' },
      { name: 'CSTV', port: Number(installConfig.tvPort || Number(installConfig.port || 27015) + 5), protocol: 'udp' }
    ];
  }

  if (template.id === 'teamspeak3') {
    return [
      { name: 'Voice', port: Number(installConfig.port || 9987), protocol: 'udp' },
      { name: 'Query', port: Number(installConfig.queryPort || 10011), protocol: 'tcp' },
      { name: 'File Transfer', port: Number(installConfig.filePort || 30033), protocol: 'tcp' }
    ];
  }

  if (template.id === 'rust') {
    return [
      { name: 'Game', port: Number(installConfig.port || 28015), protocol: 'udp' },
      { name: 'Query', port: Number(installConfig.queryPort || 28016), protocol: 'udp' },
      { name: 'RCON', port: Number(installConfig.rconPort || 28017), protocol: 'tcp' }
    ];
  }

  if (template.id === 'valheim') {
    const port = Number(installConfig.port || 2456);
    return [
      { name: 'Game', port, protocol: 'udp' },
      { name: 'Query', port: port + 1, protocol: 'udp' },
      { name: 'Steam', port: port + 2, protocol: 'udp' }
    ];
  }

  if (template.id === 'factorio') {
    return [
      { name: 'Game', port: Number(installConfig.port || 34197), protocol: 'udp' },
      { name: 'RCON', port: Number(installConfig.rconPort || 27015), protocol: 'tcp' }
    ];
  }

  if (template.id === 'project-zomboid') {
    return [
      { name: 'Game', port: Number(installConfig.port || 16261), protocol: 'udp' },
      { name: 'Steam', port: Number(installConfig.steamPort || 16262), protocol: 'udp' },
      { name: 'RCON', port: Number(installConfig.rconPort || 27015), protocol: 'tcp' }
    ];
  }

  if (template.id === 'unturned') {
    return [
      { name: 'Game', port: Number(installConfig.port || 27015), protocol: 'udp' },
      { name: 'Query', port: Number(installConfig.queryPort || 27016), protocol: 'udp' }
    ];
  }

  if (template.id === 'ark-se') {
    return [
      { name: 'Game', port: Number(installConfig.port || 7777), protocol: 'udp' },
      { name: 'Raw UDP', port: Number(installConfig.rawPort || 7778), protocol: 'udp' },
      { name: 'Query', port: Number(installConfig.queryPort || 27015), protocol: 'udp' },
      { name: 'RCON', port: Number(installConfig.rconPort || 32330), protocol: 'tcp' }
    ];
  }

  if (template.id === 'palworld') {
    return [
      { name: 'Game', port: Number(installConfig.port || 8211), protocol: 'udp' },
      { name: 'RCON', port: Number(installConfig.queryPort || 27015), protocol: 'tcp' }
    ];
  }

  if (template.id === 'satisfactory') {
    return [
      { name: 'Game UDP', port: Number(installConfig.port || 7777), protocol: 'udp' },
      { name: 'Game TCP', port: Number(installConfig.port || 7777), protocol: 'tcp' }
    ];
  }

  if (template.id === 'sinusbot') {
    return [
      { name: 'Web', port: Number(installConfig.port || 8087), protocol: 'tcp' }
    ];
  }

  return (template.ports?.length ? template.ports : [{ name: 'Game', port: 25565, protocol: 'tcp' }]).map((item, index) => ({
    ...item,
    port: Number(index === 0 ? (installConfig.port || item.port) : item.port)
  }));
}

function usedPorts(servers = []) {
  const ports = new Set();

  for (const server of servers) {
    for (const item of server.ports || []) {
      ports.add(Number(item.port));
    }

    if (server.installConfig?.tvPort) {
      ports.add(Number(server.installConfig.tvPort));
    }
  }

  return ports;
}

function nextFreePort(start, taken) {
  let port = Number(start);

  while (taken.has(port)) {
    port += 1;
  }

  taken.add(port);
  return port;
}

function allocateInstallPorts(template, installConfig, servers) {
  const taken = usedPorts(servers);
  const config = { ...installConfig };

  if (template.id === 'cs2') {
    config.port = nextFreePort(Number(config.port || 27015), taken);
    config.tvPort = nextFreePort(Number(config.tvPort || config.port + 5), taken);
    return config;
  }

  if (template.id === 'teamspeak3') {
    config.port = nextFreePort(Number(config.port || 9987), taken);
    config.queryPort = nextFreePort(Number(config.queryPort || 10011), taken);
    config.filePort = nextFreePort(Number(config.filePort || 30033), taken);
    return config;
  }

  if (template.id === 'rust') {
    config.port = nextFreePort(Number(config.port || 28015), taken);
    config.queryPort = nextFreePort(Number(config.queryPort || config.port + 1), taken);
    config.rconPort = nextFreePort(Number(config.rconPort || config.port + 2), taken);
    return config;
  }

  if (template.id === 'valheim') {
    config.port = nextFreePort(Number(config.port || 2456), taken);
    taken.add(config.port + 1);
    taken.add(config.port + 2);
    return config;
  }

  if (template.id === 'factorio') {
    config.port = nextFreePort(Number(config.port || 34197), taken);
    config.rconPort = nextFreePort(Number(config.rconPort || 27015), taken);
    return config;
  }

  if (template.id === 'project-zomboid') {
    config.port = nextFreePort(Number(config.port || 16261), taken);
    config.steamPort = nextFreePort(Number(config.steamPort || config.port + 1), taken);
    config.rconPort = nextFreePort(Number(config.rconPort || 27015), taken);
    return config;
  }

  if (template.id === 'unturned') {
    config.port = nextFreePort(Number(config.port || 27015), taken);
    config.queryPort = nextFreePort(Number(config.queryPort || config.port + 1), taken);
    return config;
  }

  if (template.id === 'ark-se') {
    config.port = nextFreePort(Number(config.port || 7777), taken);
    config.rawPort = nextFreePort(Number(config.rawPort || config.port + 1), taken);
    config.queryPort = nextFreePort(Number(config.queryPort || 27015), taken);
    config.rconPort = nextFreePort(Number(config.rconPort || 32330), taken);
    return config;
  }

  if (template.id === 'palworld') {
    config.port = nextFreePort(Number(config.port || 8211), taken);
    config.queryPort = nextFreePort(Number(config.queryPort || 27015), taken);
    return config;
  }

  if (template.id === 'satisfactory') {
    config.port = nextFreePort(Number(config.port || 7777), taken);
    return config;
  }

  if (template.id === 'sinusbot') {
    config.port = nextFreePort(Number(config.port || 8087), taken);
    return config;
  }

  if (config.port) {
    config.port = nextFreePort(Number(config.port), taken);
  }

  return config;
}

async function createVoiceOrAudioFiles(server, installConfig) {
  const filesDir = path.join(server.path, 'files');
  await fs.rm(filesDir, { recursive: true, force: true });
  await fs.mkdir(path.join(filesDir, 'config'), { recursive: true });
  await fs.mkdir(path.join(filesDir, 'data'), { recursive: true });

  if (server.game === 'mumble') {
    await fs.writeFile(path.join(filesDir, 'config', 'murmur.ini'), [
      `welcometext="${installConfig.welcomeText || 'Bem-vindo ao servidor de voz.'}"`,
      `port=${installConfig.port || 64738}`,
      `serverpassword=${installConfig.serverPassword || ''}`,
      `users=${installConfig.maxPlayers || 32}`,
      `bandwidth=${installConfig.bandwidth || 72000}`,
      'registerName=GameForge Mumble',
      'logfile=../logs/mumble.log',
      'database=../data/murmur.sqlite',
      'autobanAttempts=10',
      'autobanTimeframe=120',
      'autobanTime=300'
    ].join('\n') + '\n');
  }

  if (server.game === 'teamspeak3') {
    const tsRuntime = path.join(LIBRARY_DIR, 'teamspeak3', 'server');
    await fs.writeFile(path.join(filesDir, 'config', 'ts3server.ini'), [
      `default_voice_port=${installConfig.port || 9987}`,
      `query_port=${installConfig.queryPort || 10011}`,
      `filetransfer_port=${installConfig.filePort || 30033}`,
      `machine_id=${server.id}`,
      'licensepath=',
      'create_default_virtualserver=1',
      `default_virtualserver_name=${installConfig.serverName || server.name}`,
      `default_virtualserver_maxclients=${installConfig.maxPlayers || 32}`,
      `default_virtualserver_password=${installConfig.serverPassword || ''}`,
      'dbplugin=ts3db_sqlite3',
      `dbpluginparameter=${path.join(filesDir, 'data', 'ts3server.sqlitedb')}`,
      `dbsqlpath=${path.join(tsRuntime, 'sql')}/`,
      'dbsqlcreatepath=create_sqlite/',
      'logpath=../logs',
      'query_ip=0.0.0.0',
      'filetransfer_ip=0.0.0.0'
    ].join('\n') + '\n');
  }

  if (server.game === 'icecast') {
    await fs.writeFile(path.join(filesDir, 'config', 'icecast.xml'), [
      '<icecast>',
      `  <location>${escapeXml(installConfig.location || 'Portugal')}</location>`,
      '  <admin>admin@gameforge.local</admin>',
      '  <limits>',
      `    <clients>${installConfig.maxPlayers || 100}</clients>`,
      '    <sources>4</sources>',
      '    <queue-size>524288</queue-size>',
      '    <client-timeout>30</client-timeout>',
      '    <header-timeout>15</header-timeout>',
      '    <source-timeout>10</source-timeout>',
      '  </limits>',
      '  <authentication>',
      `    <source-password>${escapeXml(installConfig.sourcePassword || 'change-me-source')}</source-password>`,
      `    <admin-password>${escapeXml(installConfig.adminPassword || 'change-me-admin')}</admin-password>`,
      '  </authentication>',
      `  <hostname>${escapeXml(installConfig.hostname || 'aleijados.duckdns.org')}</hostname>`,
      '  <listen-socket>',
      `    <port>${installConfig.port || 8000}</port>`,
      '  </listen-socket>',
      `  <mount><mount-name>${escapeXml(installConfig.mount || '/live')}</mount-name></mount>`,
      '  <fileserve>1</fileserve>',
      '  <paths>',
      '    <logdir>../logs</logdir>',
      '    <webroot>/usr/share/icecast2/web</webroot>',
      '    <adminroot>/usr/share/icecast2/admin</adminroot>',
      '  </paths>',
      '</icecast>'
    ].join('\n') + '\n');
  }

  const startScriptLines = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'cd "$(dirname "$0")"',
    'mkdir -p ../logs data',
    'echo "===== GAMEFORGE SERVICE START $(date) =====" >> ../logs/process.log',
    `echo "Template: ${server.gameName}" >> ../logs/process.log`,
    `echo "Portas: ${server.ports.map((port) => `${port.name} ${port.port}/${port.protocol}`).join(', ')}" >> ../logs/process.log`,
    '',
    'case "' + server.game + '" in',
    '  mumble)',
    '    if command -v murmurd >/dev/null 2>&1; then',
    '      exec murmurd -fg -ini config/murmur.ini',
    '    fi',
    '    echo "murmurd nao esta instalado. Instala o pacote mumble-server." >> ../logs/process.log',
    '    exit 127',
    '    ;;',
    '  icecast)',
    '    if command -v icecast2 >/dev/null 2>&1; then',
    '      exec icecast2 -c config/icecast.xml',
    '    fi',
    '    echo "icecast2 nao esta instalado. Instala o pacote icecast2." >> ../logs/process.log',
    '    exit 127',
    '    ;;',
    '  teamspeak3)',
    `    runtime="${path.join(LIBRARY_DIR, 'teamspeak3', 'server')}"`,
    '    if [ -x "$runtime/ts3server" ]; then',
    '      touch .ts3server_license_accepted',
    '      export TS3SERVER_LICENSE=accept',
    '      exec "$runtime/ts3server" inifile="$PWD/config/ts3server.ini" license_accepted=1',
    '    fi',
    '    echo "TeamSpeak 3 requer binario ts3server e aceitacao da licenca." >> ../logs/process.log',
    '    exit 127',
    '    ;;',
    '  *)',
    '    echo "Servico sem runtime ligado." >> ../logs/process.log',
    '    exit 127',
    '    ;;',
    'esac'
  ];

  await fs.writeFile(path.join(filesDir, 'start.sh'), startScriptLines.join('\n') + '\n');

  await fs.chmod(path.join(filesDir, 'start.sh'), 0o755);

  await fs.writeFile(path.join(filesDir, 'GAMEFORGE-SERVICE.json'), JSON.stringify({
    service: server.game,
    name: server.name,
    ports: server.ports,
    configFiles: {
      mumble: 'config/murmur.ini',
      teamspeak3: 'config/ts3server.ini',
      icecast: 'config/icecast.xml'
    }[server.game],
    generatedAt: new Date().toISOString()
  }, null, 2));
}

async function createMinecraftPaperFiles(server, installConfig) {
  const filesDir = path.join(server.path, 'files');
  await fs.rm(filesDir, { recursive: true, force: true });
  await fs.mkdir(path.join(filesDir, 'data'), { recursive: true });

  await fs.writeFile(path.join(filesDir, 'eula.txt'), 'eula=true\n');
  await fs.writeFile(path.join(filesDir, 'server.properties'), [
    `motd=${installConfig.motd || server.name}`,
    `server-port=${installConfig.port || 25565}`,
    `max-players=${installConfig.maxPlayers || 20}`,
    `online-mode=${installConfig.onlineMode || 'true'}`,
    `level-name=${installConfig.worldName || 'world'}`,
    `difficulty=${installConfig.difficulty || 'normal'}`,
    `gamemode=${installConfig.gameMode || 'survival'}`,
    'enable-rcon=false',
    'view-distance=10',
    'simulation-distance=10'
  ].join('\n') + '\n');

  await fs.writeFile(path.join(filesDir, 'start.sh'), [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'cd "$(dirname "$0")"',
    'mkdir -p ../logs data',
    'JAR="./paper.jar"',
    'if [ ! -f "$JAR" ]; then',
    '  echo "[INSTALL] Downloading latest PaperMC build..." >> ../logs/process.log',
    '  node <<\'NODE\'',
    'const fs = require("fs");',
    'const https = require("https");',
    'const { execFileSync } = require("child_process");',
    'function getJson(url) {',
    '  return new Promise((resolve, reject) => {',
    '    https.get(url, (res) => {',
    '      let data = "";',
    '      res.on("data", (chunk) => data += chunk);',
    '      res.on("end", () => resolve(JSON.parse(data)));',
    '    }).on("error", reject);',
    '  });',
    '}',
    '(async () => {',
    '  const base = "https://api.papermc.io/v2/projects/paper";',
    '  const project = await getJson(base);',
    '  const version = project.versions[project.versions.length - 1];',
    '  const builds = await getJson(`${base}/versions/${version}`);',
    '  const build = builds.builds[builds.builds.length - 1];',
    '  const meta = await getJson(`${base}/versions/${version}/builds/${build}`);',
    '  const name = meta.downloads.application.name;',
    '  const url = `${base}/versions/${version}/builds/${build}/downloads/${name}`;',
    '  execFileSync("curl", ["-L", "-o", "paper.jar", url], { stdio: "inherit" });',
    '  fs.writeFileSync("GAMEFORGE-PAPER.json", JSON.stringify({ version, build, name, installedAt: new Date().toISOString() }, null, 2));',
    '})();',
    'NODE',
    'fi',
    `exec java -Xms${installConfig.ramMb || 2048}M -Xmx${installConfig.ramMb || 2048}M -jar "$JAR" nogui`
  ].join('\n') + '\n');

  await fs.chmod(path.join(filesDir, 'start.sh'), 0o755);
}

async function createSteamcmdGameFiles(server, installConfig, steamAppId, startLines) {
  const filesDir = path.join(server.path, 'files');
  await fs.rm(filesDir, { recursive: true, force: true });
  await fs.mkdir(path.join(filesDir, 'game'), { recursive: true });
  await fs.mkdir(path.join(filesDir, 'data'), { recursive: true });

  await fs.writeFile(path.join(filesDir, 'start.sh'), [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'cd "$(dirname "$0")"',
    'mkdir -p ../logs game data',
    'if [ ! -f game/.gameforge-installed ]; then',
    `  echo "[INSTALL] SteamCMD app ${steamAppId}..." >> ../logs/process.log`,
    `  steamcmd +force_install_dir "$PWD/game" +login anonymous +app_update ${steamAppId} validate +quit >> ../logs/process.log 2>&1`,
    '  date -Is > game/.gameforge-installed',
    'fi',
    'cd game',
    ...startLines
  ].join('\n') + '\n');

  await fs.chmod(path.join(filesDir, 'start.sh'), 0o755);
  await fs.writeFile(path.join(filesDir, 'GAMEFORGE-STEAMCMD.json'), JSON.stringify({
    service: server.game,
    appId: steamAppId,
    generatedAt: new Date().toISOString(),
    installConfig
  }, null, 2));
}

async function createFactorioFiles(server, installConfig) {
  const filesDir = path.join(server.path, 'files');
  await fs.rm(filesDir, { recursive: true, force: true });
  await fs.mkdir(path.join(filesDir, 'data'), { recursive: true });

  await fs.writeFile(path.join(filesDir, 'server-settings.json'), JSON.stringify({
    name: installConfig.serverName || server.name,
    description: installConfig.description || 'GameForge Factorio server',
    tags: ['gameforge'],
    max_players: Number(installConfig.maxPlayers || 16),
    visibility: { public: false, lan: true },
    username: '',
    password: '',
    game_password: installConfig.serverPassword || '',
    require_user_verification: false,
    max_upload_in_kilobytes_per_second: 0,
    max_upload_slots: 5,
    ignore_player_limit_for_returning_players: false,
    allow_commands: 'admins-only',
    autosave_interval: 10,
    autosave_slots: 5,
    afk_autokick_interval: 0,
    auto_pause: true,
    only_admins_can_pause_the_game: true,
    autosave_only_on_server: true
  }, null, 2));

  await fs.writeFile(path.join(filesDir, 'start.sh'), [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'cd "$(dirname "$0")"',
    'mkdir -p ../logs data',
    'if [ ! -x factorio/bin/x64/factorio ]; then',
    '  echo "[INSTALL] Downloading Factorio headless..." >> ../logs/process.log',
    '  curl -L -o factorio.tar.xz https://factorio.com/get-download/stable/headless/linux64 >> ../logs/process.log 2>&1',
    '  tar -xJf factorio.tar.xz',
    'fi',
    'if [ ! -f data/save.zip ]; then',
    '  ./factorio/bin/x64/factorio --create data/save.zip >> ../logs/process.log 2>&1',
    'fi',
    `exec ./factorio/bin/x64/factorio --start-server data/save.zip --server-settings server-settings.json --port ${installConfig.port || 34197} --rcon-port ${installConfig.rconPort || 27015} --rcon-password "${installConfig.rconPassword || crypto.randomBytes(12).toString('hex')}"`
  ].join('\n') + '\n');

  await fs.chmod(path.join(filesDir, 'start.sh'), 0o755);
}

async function createSinusBotFiles(server, installConfig) {
  const filesDir = path.join(server.path, 'files');
  const botPassword = installConfig.webPassword || crypto.randomBytes(12).toString('base64url');
  await fs.rm(filesDir, { recursive: true, force: true });
  await fs.mkdir(path.join(filesDir, 'data'), { recursive: true });
  await fs.mkdir(path.join(filesDir, 'config'), { recursive: true });

  await fs.writeFile(path.join(filesDir, 'config.ini'), [
    `ListenHost = "0.0.0.0"`,
    `ListenPort = ${installConfig.port || 8087}`,
    `DataDir = "../data/"`,
    `TS3Path = "TeamSpeak3-Client-linux_amd64/ts3client_linux_amd64"`,
    `YoutubeDLPath = "/usr/local/bin/yt-dlp"`,
    `LogLevel = 10`,
    `EnableLocalFS = true`,
    `EnableInternalCommands = true`,
    `IsProxied = true`
  ].join('\n') + '\n');

  await fs.writeFile(path.join(filesDir, 'config', 'credentials.txt'), [
    'SinusBot Web',
    'URL local: http://127.0.0.1:' + (installConfig.port || 8087),
    'URL painel: /sinusbot/',
    'User: admin',
    `Password: ${botPassword}`,
    '',
    `TeamSpeak alvo: ${installConfig.ts3Host || '127.0.0.1'}:${installConfig.ts3Port || 9987}`,
    installConfig.defaultChannel ? `Canal default: ${installConfig.defaultChannel}` : ''
  ].filter(Boolean).join('\n') + '\n');

  await fs.writeFile(path.join(filesDir, 'start.sh'), [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'cd "$(dirname "$0")"',
    'mkdir -p ../logs data',
    'if [ "$(id -u)" = "0" ] && id ogp >/dev/null 2>&1; then',
    '  chown -R ogp:ogp "$(pwd)" ../logs',
    '  exec runuser -u ogp -- "$0" --as-ogp',
    'fi',
    `SHARED_RUNTIME="${path.join(LIBRARY_DIR, 'sinusbot', 'current')}"`,
    `SHARED_TS3="${path.join(LIBRARY_DIR, 'teamspeak3', 'client', 'TeamSpeak3-Client-linux_amd64')}"`,
    'RUNTIME="$(pwd)/runtime"',
    'TS3CLIENT="$RUNTIME/TeamSpeak3-Client-linux_amd64/ts3client_linux_amd64"',
    'if [ ! -x "$SHARED_RUNTIME/sinusbot" ]; then',
    '  echo "[ERROR] SinusBot runtime em falta: $SHARED_RUNTIME/sinusbot" >> ../logs/process.log',
    '  exit 127',
    'fi',
    'if [ ! -x "$RUNTIME/sinusbot" ]; then',
    '  echo "[INSTALL] A preparar runtime dedicado do SinusBot..." >> ../logs/process.log',
    '  rm -rf "$RUNTIME"',
    '  mkdir -p "$RUNTIME"',
    '  cp -a "$SHARED_RUNTIME/." "$RUNTIME/"',
    'fi',
    'if [ ! -x "$TS3CLIENT" ]; then',
    '  echo "[INSTALL] A preparar TeamSpeak Client dedicado para o SinusBot..." >> ../logs/process.log',
    '  rm -rf "$RUNTIME/TeamSpeak3-Client-linux_amd64"',
    '  cp -a "$SHARED_TS3" "$RUNTIME/TeamSpeak3-Client-linux_amd64"',
    'fi',
    'cp config.ini "$RUNTIME/config.ini"',
    'if [ ! -x "$TS3CLIENT" ]; then',
    '  echo "[ERROR] TeamSpeak client runtime em falta: $TS3CLIENT" >> ../logs/process.log',
    '  exit 127',
    'fi',
    'if [ -f "$SHARED_RUNTIME/plugin/libsoundbot_plugin.so" ]; then',
    '  mkdir -p "$RUNTIME/TeamSpeak3-Client-linux_amd64/plugins"',
    '  cp "$SHARED_RUNTIME/plugin/libsoundbot_plugin.so" "$RUNTIME/TeamSpeak3-Client-linux_amd64/plugins/" || true',
    'fi',
    'if ! command -v yt-dlp >/dev/null 2>&1; then',
    '  echo "[WARN] yt-dlp em falta. O bot pode arrancar, mas streaming de links pode falhar." >> ../logs/process.log',
    'fi',
    'if [ ! -f data/.gameforge-password-set ]; then',
    `  echo "[INFO] A definir password web inicial do SinusBot." >> ../logs/process.log`,
    `  "$RUNTIME/sinusbot" -override-password "${botPassword}" >> ../logs/process.log 2>&1 || true`,
    '  touch data/.gameforge-password-set',
    'fi',
    'cd "$RUNTIME"',
    'exec ./sinusbot'
  ].join('\n') + '\n');

  await fs.chmod(path.join(filesDir, 'start.sh'), 0o755);
}

async function createProvisionedFiles(server, installConfig) {
  const filesDir = path.join(server.path, 'files');

  if (server.game === 'cs2') {
    await installCS2Server(server, installConfig);
    await applyGameConfigIfSupported(server, 'provision');
    return;
  }

  if (['mumble', 'teamspeak3', 'icecast'].includes(server.game)) {
    await createVoiceOrAudioFiles(server, installConfig);
    return;
  }

  if (server.game === 'minecraft-paper') {
    await createMinecraftPaperFiles(server, installConfig);
    return;
  }

  if (server.game === 'valheim') {
    await createSteamcmdGameFiles(server, installConfig, 896660, [
      'export templdpath="$LD_LIBRARY_PATH"',
      'export LD_LIBRARY_PATH=./linux64:"$LD_LIBRARY_PATH"',
      'export SteamAppId=892970',
      `exec ./valheim_server.x86_64 -nographics -batchmode -name "${installConfig.serverName || server.name}" -port ${installConfig.port || 2456} -world "${installConfig.worldName || 'Dedicated'}" -password "${installConfig.serverPassword || 'change-me'}" -public ${installConfig.publicServer ? 1 : 0}`
    ]);
    return;
  }

  if (server.game === 'rust') {
    await createSteamcmdGameFiles(server, installConfig, 258550, [
      `exec ./RustDedicated -batchmode +server.port ${installConfig.port || 28015} +server.queryport ${installConfig.queryPort || 28016} +server.identity "${server.id}" +server.hostname "${installConfig.serverName || server.name}" +server.maxplayers ${installConfig.maxPlayers || 50} +server.worldsize ${installConfig.worldSize || 3500} +server.seed ${installConfig.seed || 12345} +rcon.port ${installConfig.rconPort || 28017} +rcon.password "${installConfig.rconPassword || crypto.randomBytes(12).toString('hex')}" +rcon.web 1 -logfile ../logs/rust.log`
    ]);
    return;
  }

  if (server.game === 'gmod') {
    await createSteamcmdGameFiles(server, installConfig, 4020, [
      `exec ./srcds_run -game garrysmod +map ${installConfig.map || 'gm_construct'} +maxplayers ${installConfig.maxPlayers || 16} -port ${installConfig.port || 27015} +hostname "${installConfig.serverName || server.name}"`
    ]);
    return;
  }

  if (server.game === 'factorio') {
    await createFactorioFiles(server, installConfig);
    return;
  }

  if (server.game === 'project-zomboid') {
    await createSteamcmdGameFiles(server, installConfig, 380870, [
      'mkdir -p "../data/Zomboid/Server"',
      `exec ./start-server.sh -servername "${server.id}" -cachedir="$(readlink -f ../data/Zomboid)"`
    ]);
    return;
  }

  if (server.game === 'unturned') {
    await createSteamcmdGameFiles(server, installConfig, 1110390, [
      `mkdir -p "Servers/${server.id}/Server"`,
      `cat > "Servers/${server.id}/Server/Commands.dat" <<'EOF'`,
      `Name ${installConfig.serverName || server.name}`,
      `Port ${installConfig.port || 27015}`,
      `MaxPlayers ${installConfig.maxPlayers || 24}`,
      `Map ${installConfig.map || 'PEI'}`,
      `Mode ${installConfig.mode || 'normal'}`,
      `Perspective Both`,
      `Cheats Disabled`,
      `EOF`,
      `exec ./ServerHelper.sh +InternetServer/${server.id}`
    ]);
    return;
  }

  if (server.game === 'ark-se') {
    await createSteamcmdGameFiles(server, installConfig, 376030, [
      `exec ./ShooterGame/Binaries/Linux/ShooterGameServer "${installConfig.map || 'TheIsland'}?listen?SessionName=${installConfig.serverName || server.name}?ServerPassword=${installConfig.serverPassword || ''}?ServerAdminPassword=${installConfig.adminPassword || crypto.randomBytes(12).toString('hex')}?Port=${installConfig.port || 7777}?QueryPort=${installConfig.queryPort || 27015}?RCONPort=${installConfig.rconPort || 32330}" -server -log -NoBattlEye`
    ]);
    return;
  }

  if (server.game === 'palworld') {
    await createSteamcmdGameFiles(server, installConfig, 2394010, [
      `mkdir -p Pal/Saved/Config/LinuxServer`,
      `cat > Pal/Saved/Config/LinuxServer/PalWorldSettings.ini <<'EOF'`,
      `[/Script/Pal.PalGameWorldSettings]`,
      `OptionSettings=(ServerName="${installConfig.serverName || server.name}",ServerPassword="${installConfig.serverPassword || ''}",AdminPassword="${installConfig.adminPassword || crypto.randomBytes(12).toString('hex')}",PublicPort=${installConfig.port || 8211},PublicIP="",RCONEnabled=True,RCONPort=${installConfig.queryPort || 27015})`,
      `EOF`,
      `exec ./PalServer.sh -useperfthreads -NoAsyncLoadingThread -UseMultithreadForDS`
    ]);
    return;
  }

  if (server.game === 'satisfactory') {
    await createSteamcmdGameFiles(server, installConfig, 1690800, [
      `exec ./FactoryServer.sh -Port=${installConfig.port || 7777} -ServerQueryPort=${installConfig.port || 7777} -BeaconPort=${installConfig.port || 7777} -multihome=0.0.0.0`
    ]);
    return;
  }

  if (server.game === 'sinusbot') {
    await createSinusBotFiles(server, installConfig);
    return;
  }

  await fs.rm(filesDir, { recursive: true, force: true });
  await fs.mkdir(filesDir, { recursive: true });

  if (server.game === 'minecraft-java') {
    await fs.writeFile(path.join(filesDir, 'eula.txt'), 'eula=true\n');

    await fs.writeFile(path.join(filesDir, 'server.properties'), [
      `motd=${installConfig.motd || server.name}`,
      `server-port=${installConfig.port || 25565}`,
      `max-players=${installConfig.maxPlayers || 20}`,
      `online-mode=${installConfig.onlineMode || 'true'}`,
      'enable-rcon=false',
      'difficulty=normal',
      'gamemode=survival',
      'view-distance=10',
      'simulation-distance=10'
    ].join('\n') + '\n');
  } else {
    await fs.writeFile(path.join(filesDir, 'server-config.json'), JSON.stringify(installConfig, null, 2));
  }

  await fs.writeFile(path.join(filesDir, 'start.sh'), [
    '#!/usr/bin/env bash',
    'cd "$(dirname "$0")"',
    'echo "Servidor provisionado. Binários reais serão extraídos da Game Library futuramente."'
  ].join('\n') + '\n');

  await fs.chmod(path.join(filesDir, 'start.sh'), 0o755);

  await fs.writeFile(path.join(filesDir, 'GAMEFORGE-NOTES.txt'), [
    'GameForge Provisioning Mode',
    '',
    'Servidor aprovado pelo admin e provisionado para o cliente.',
    'Instalação real/cache será ativada numa fase posterior.',
    '',
    `Servidor: ${server.name}`,
    `Cliente: ${server.ownerName}`,
    `Jogo: ${server.gameName}`,
    `Path: ${server.path}`
  ].join('\n') + '\n');
}

async function hydrateServer(server) {
  const status = await readJson(path.join(server.path, 'status.json'), {
    status: server.status || 'offline',
    installStatus: server.installStatus || 'provisioned',
    pid: null
  });

  const config = await readJson(path.join(server.path, 'config.json'), server);
  const processInfo = await isServerProcessRunning({ ...server, ...config });
  const liveStatus = processInfo.running ? 'online' : status.status;

  return {
    ...server,
    ...config,
    status: liveStatus,
    installStatus: status.installStatus,
    runtime: {
      ...status,
      pid: processInfo.pid || status.pid || null,
      processRunning: processInfo.running
    }
  };
}

export async function listServers(user) {
  const servers = await readServersIndex();
  const visibleServers = servers.filter((server) => canAccessServer(server, user));
  const hydrated = [];

  for (const server of visibleServers) {
    hydrated.push(await hydrateServer(server));
  }

  return hydrated.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function getServer(id, user) {
  const servers = await readServersIndex();
  const server = servers.find((item) => item.id === id);

  if (!server || !canAccessServer(server, user)) {
    return null;
  }

  return hydrateServer(server);
}

export async function installServer(payload = {}, user) {
  if (!user || user.role !== 'admin') {
    throw new Error('Só o admin pode provisionar servidores');
  }

  await ensureBaseDirs();

  const catalog = await getCatalog();
  const template = catalog.find((item) => item.id === payload.game);

  if (!template) throw new Error('Template de jogo inválido');

  const servers = await readServersIndex();
  const installConfig = allocateInstallPorts(
    template,
    validateInstallConfig(template, payload.config || {}),
    servers
  );

  if (template.id === 'sinusbot' && !installConfig.webPassword) {
    installConfig.webPassword = crypto.randomBytes(12).toString('base64url');
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const storageRoot = await getStorageRoot(payload.storageRootId || payload.config?.storageRootId);
  const serverPath = path.join(storageRoot.path, id);

  const server = {
    id,
    ownerId: payload.ownerId || null,
    ownerName: payload.ownerName || 'Sem cliente',
    ownerEmail: payload.ownerEmail || '',
    name: installConfig.serverName || template.name,
    game: template.id,
    gameName: template.name,
    templateId: template.id,
    node: 'local-node-01',
    status: 'offline',
    installStatus: 'provisioned',
    provisioningMode: 'admin-approved',
    lastReinstallAt: null,
    reinstallCount: 0,
    resources: {
      ramMb: Number(installConfig.ramMb || template.defaultResources.ramMb),
      cpuLimit: Number(payload.cpuLimit || template.defaultResources.cpuLimit),
      diskMb: Number(payload.diskMb || template.defaultResources.diskMb)
    },
    ports: buildPorts(template, installConfig),
    installConfig,
    storageRootId: storageRoot.id,
    storageRootLabel: storageRoot.label,
    storagePath: storageRoot.path,
    path: serverPath,
    createdAt: now,
    updatedAt: now
  };

  await fs.mkdir(path.join(serverPath, 'logs'), { recursive: true });

  if (server.game === 'cs2') {
    await saveConfig(server.id, {
      hostname: server.name,
      maxplayers: installConfig.maxPlayers || 12,
      tv_port: installConfig.tvPort || Number(installConfig.port || 27015) + 5
    });
  }

  try {
    await createProvisionedFiles(server, installConfig);
  } catch (err) {
    await appendLog(serverPath, `Falha ao provisionar ${server.name}: ${err.message}`);
    throw new Error(`Erro ao criar servidor ${template.name}: ${err.message}`);
  }

  await writeJson(path.join(serverPath, 'config.json'), server);
  await writeJson(path.join(serverPath, 'status.json'), {
    status: 'offline',
    installStatus: 'provisioned',
    pid: null,
    lastAction: 'admin-provisioned',
    updatedAt: now
  });

  await appendLog(serverPath, `Servidor aprovado e provisionado pelo admin: ${server.name}`);
  await appendLog(serverPath, `Cliente: ${server.ownerName} <${server.ownerEmail}>`);

  await addActivity({
    type: 'server.provisioned',
    title: 'Servidor provisionado',
    message: `${user.email} provisionou ${server.name} para ${server.ownerEmail}`,
    actorId: user.id,
    actorEmail: user.email,
    actorRole: user.role,
    clientId: server.ownerId,
    serverId: server.id
  });

  servers.push(server);
  await writeServersIndex(servers);

  return hydrateServer(server);
}


export async function updateServerConfig(id, user, updates = {}) {
  const servers = await readServersIndex();
  const index = servers.findIndex((server) => server.id === id);

  if (index === -1 || !canAccessServer(servers[index], user)) {
    throw new Error('Servidor não encontrado');
  }

  const server = servers[index];

  const catalog = await getCatalog();
  const template = catalog.find((item) => item.id === server.templateId || item.id === server.game);
  const schemaKeys = (template?.schema || []).map((field) => field.key);
  const allowed = [...new Set(['serverName', 'motd', 'maxPlayers', 'port', 'ramMb', 'onlineMode', ...schemaKeys])];
  const cleanUpdates = {};

  for (const key of allowed) {
    if (updates[key] !== undefined) {
      cleanUpdates[key] = updates[key];
    }
  }

  if (cleanUpdates.maxPlayers !== undefined) {
    cleanUpdates.maxPlayers = Number(cleanUpdates.maxPlayers);
    if (cleanUpdates.maxPlayers < 1 || cleanUpdates.maxPlayers > 500) {
      throw new Error('Slots inválidos');
    }
  }

  if (cleanUpdates.port !== undefined) {
    cleanUpdates.port = Number(cleanUpdates.port);
    if (cleanUpdates.port < 1024 || cleanUpdates.port > 65535) {
      throw new Error('Porta inválida');
    }
  }

  if (cleanUpdates.ramMb !== undefined) {
    cleanUpdates.ramMb = Number(cleanUpdates.ramMb);
    if (cleanUpdates.ramMb < 512 || cleanUpdates.ramMb > 131072) {
      throw new Error('RAM inválida');
    }
  }

  server.installConfig = {
    ...(server.installConfig || {}),
    ...cleanUpdates
  };

  if (cleanUpdates.serverName) {
    server.name = cleanUpdates.serverName;
  }

  if (cleanUpdates.ramMb) {
    server.resources.ramMb = cleanUpdates.ramMb;
  }

  if (cleanUpdates.port) {
    server.ports = template
      ? buildPorts(template, { ...server.installConfig, ...cleanUpdates })
      : [
          {
            ...(server.ports?.[0] || {}),
            name: 'Game',
            port: cleanUpdates.port,
            protocol: server.ports?.[0]?.protocol || 'tcp'
          }
        ];
  }

  server.updatedAt = new Date().toISOString();

  await createProvisionedFiles(server, server.installConfig);

  await writeJson(path.join(server.path, 'config.json'), server);

  await appendLog(server.path, `Configuração atualizada por ${user.email}.`);

  await addActivity({
    type: 'server.config',
    title: 'Configuração atualizada',
    message: `${user.email} atualizou configurações de ${server.name}`,
    actorId: user.id,
    actorEmail: user.email,
    actorRole: user.role,
    clientId: server.ownerId,
    serverId: server.id
  });

  servers[index] = server;
  await writeServersIndex(servers);

  return hydrateServer(server);
}

export async function deleteServer(arg1, arg2 = null) {
  const fsMod = await import('fs/promises');
  const pathMod = await import('path');

  const fs = fsMod.default;
  const path = pathMod.default;

  const ROOT = process.env.GAMEFORGE_ROOT || '/opt/xcat-panel';
  const DATA_FILE = path.join(ROOT, 'data', 'servers.json');
  const SERVERS_ROOT = path.join(ROOT, 'servers');

  const user = typeof arg1 === 'object' && arg1 !== null ? arg1 : null;
  const serverId = typeof arg1 === 'string' ? arg1 : arg2;

  if (!serverId) {
    return { ok: false, error: 'ID do servidor em falta' };
  }

  const raw = await fs.readFile(DATA_FILE, 'utf8');
  const items = JSON.parse(raw);

  const index = items.findIndex((item) => item.id === serverId);

  if (index === -1) {
    return { ok: false, error: 'Servidor não encontrado' };
  }

  const server = items[index];

  if (user && user.role !== 'admin') {
    const ownsServer =
      server.ownerId === user.id ||
      server.ownerId === user.email ||
      server.ownerEmail === user.email ||
      server.clientEmail === user.email ||
      server.clientId === user.id;

    if (!ownsServer) {
      return { ok: false, error: 'Sem permissão para apagar este servidor' };
    }
  }

  const serverPath = path.resolve(server.path || path.join(SERVERS_ROOT, server.id));

  if (!(await isPathInsideStorageRoots(serverPath))) {
    return {
      ok: false,
      error: `Caminho inseguro. Recusado apagar: ${serverPath}`
    };
  }

  try {
    await stopServerProcess(server);
  } catch {}

  try {
    await unmountServerFiles(serverPath);
  } catch {}

  await fs.rm(serverPath, {
    recursive: true,
    force: true
  });

  if (server.game === 'cs2') {
    await deleteCs2ConfigRecord(server.id);
  }

  items.splice(index, 1);
  await fs.writeFile(DATA_FILE, JSON.stringify(items, null, 2));

  return {
    ok: true,
    deletedServerId: server.id,
    deletedPath: serverPath
  };
}

export async function reinstallServer(id, user) {
  const servers = await readServersIndex();
  const index = servers.findIndex((server) => server.id === id);

  if (index === -1 || !canAccessServer(servers[index], user)) {
    throw new Error('Servidor não encontrado');
  }

  const server = servers[index];

  const now = new Date();
  const lastReinstallAt = server.lastReinstallAt ? new Date(server.lastReinstallAt) : null;

  if (user.role !== 'admin' && lastReinstallAt) {
    const diffMs = now.getTime() - lastReinstallAt.getTime();
    const cooldownMs = REINSTALL_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

    if (diffMs < cooldownMs) {
      const remainingMs = cooldownMs - diffMs;
      const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
      throw new Error(`Só podes reinstalar este servidor novamente dentro de ${remainingDays} dia(s).`);
    }
  }

  server.status = 'offline';
  server.installStatus = 'provisioned';
  server.lastReinstallAt = now.toISOString();
  server.reinstallCount = Number(server.reinstallCount || 0) + 1;
  server.updatedAt = now.toISOString();

  try {
    await stopServerProcess(server);
  } catch {}

  try {
    await fs.mkdir(path.join(server.path, 'logs'), { recursive: true });
    await createProvisionedFiles(server, server.installConfig || {});
  } catch (err) {
    await appendLog(server.path, `Falha ao reinstalar: ${err.message}`);
    throw new Error(`Erro ao reinstalar servidor: ${err.message}`);
  }

  await writeJson(path.join(server.path, 'config.json'), server);
  await writeJson(path.join(server.path, 'status.json'), {
    status: 'offline',
    installStatus: 'provisioned',
    pid: null,
    lastAction: 'reinstall',
    updatedAt: server.updatedAt
  });

  await appendLog(server.path, `Servidor reinstalado por ${user.email}.`);
  await appendLog(server.path, user.role === 'admin'
    ? 'Reinstalação forçada por administrador.'
    : `Cooldown aplicado: ${REINSTALL_COOLDOWN_DAYS} dias.`);

  await addActivity({
    type: 'server.reinstalled',
    title: 'Servidor reinstalado',
    message: `${user.email} reinstalou ${server.name}`,
    actorId: user.id,
    actorEmail: user.email,
    actorRole: user.role,
    clientId: server.ownerId,
    serverId: server.id
  });

  servers[index] = server;
  await writeServersIndex(servers);

  return hydrateServer(server);
}

export async function assignServerOwner(id, payload = {}, user) {
  if (!user || user.role !== 'admin') {
    throw new Error('Só o admin pode atribuir servidores');
  }

  const servers = await readServersIndex();
  const index = servers.findIndex((server) => server.id === id);

  if (index === -1) throw new Error('Servidor não encontrado');

  const server = servers[index];
  server.ownerId = payload.ownerId || null;
  server.ownerName = payload.ownerName || 'Sem cliente';
  server.ownerEmail = payload.ownerEmail || '';
  server.updatedAt = new Date().toISOString();

  await writeJson(path.join(server.path, 'config.json'), server);
  await appendLog(server.path, `Servidor atribuído a ${server.ownerName} <${server.ownerEmail}> por ${user.email}.`);

  await addActivity({
    type: 'server.assigned',
    title: 'Servidor atribuído',
    message: `${user.email} atribuiu ${server.name} a ${server.ownerEmail || server.ownerName}`,
    actorId: user.id,
    actorEmail: user.email,
    actorRole: user.role,
    clientId: server.ownerId,
    serverId: server.id
  });

  servers[index] = server;
  await writeServersIndex(servers);

  return hydrateServer(server);
}

export async function startServer(id, user) {
  const server = await getServer(id, user);
  if (!server) throw new Error('Servidor não encontrado');

  const existing = await isServerProcessRunning(server);

  if (existing.running) {
    const result = await updateRuntimeStatus(id, 'online', 'start-already-running', user, existing.pid);

    return {
      ok: true,
      action: 'already-running',
      pid: existing.pid,
      item: result
    };
  }

  await updateRuntimeStatus(id, 'starting', 'start-requested', user, null, {
    label: 'A preparar arranque',
    step: 'prepare',
    percent: 15
  });

  try {
    if (server.game === 'cs2') {
      await updateRuntimeStatus(id, 'starting', 'mount-cs2-overlay', user, null, {
        label: 'A montar ficheiros do CS2',
        step: 'mount',
        percent: 35
      });
      await ensureCs2OverlayMounted(server);
      await appendLog(server.path, 'Overlay CS2 montado automaticamente antes do start.');
    }

    await updateRuntimeStatus(id, 'starting', 'apply-runtime-config', user, null, {
      label: 'A aplicar configuração',
      step: 'config',
      percent: 55
    });
    await applyGameConfigIfSupported(server, 'start');

    await updateRuntimeStatus(id, 'starting', 'launch-process', user, null, {
      label: 'A iniciar processo',
      step: 'launch',
      percent: 75
    });
    const processResult = await startServerProcess(server);
    await sleep(1500);
    const liveProcess = await isServerProcessRunning(server);

    if (!liveProcess.running) {
      throw new Error('O processo arrancou mas saiu logo de seguida. Verifica a consola/logs do servidor.');
    }

    const result = await updateRuntimeStatus(id, 'online', processResult.alreadyRunning ? 'start-already-running' : 'start-real', user, liveProcess.pid || processResult.pid);

    return {
      ok: true,
      action: processResult.alreadyRunning ? 'already-running' : 'started',
      pid: liveProcess.pid || processResult.pid,
      item: result
    };
  } catch (err) {
    await updateRuntimeStatus(id, 'offline', 'start-failed', user, null, {
      label: 'Erro ao iniciar',
      step: 'error',
      percent: 0,
      error: err.message
    });
    throw err;
  }
}

export async function stopServer(id, user) {
  const server = await getServer(id, user);
  if (!server) throw new Error('Servidor não encontrado');

  await updateRuntimeStatus(id, 'stopping', 'stop-requested', user, null, {
    label: 'A parar processo',
    step: 'stop',
    percent: 50
  });
  const processResult = await stopServerProcess(server);
  const result = await updateRuntimeStatus(id, 'offline', processResult.wasRunning ? 'stop-real' : 'stop-not-running', user, null);

  return {
    ok: true,
    action: processResult.wasRunning ? 'stopped' : 'not-running',
    pid: processResult.pid,
    item: result
  };
}

export async function restartServer(id, user) {
  const server = await getServer(id, user);
  if (!server) throw new Error('Servidor não encontrado');

  await updateRuntimeStatus(id, 'restarting', 'restart-real', user, null, {
    label: 'A reiniciar',
    step: 'restart',
    percent: 25
  });
  await stopServerProcess(server);

  if (server.game === 'cs2') {
    await updateRuntimeStatus(id, 'restarting', 'mount-cs2-overlay', user, null, {
      label: 'A montar ficheiros do CS2',
      step: 'mount',
      percent: 45
    });
    await ensureCs2OverlayMounted(server);
    await appendLog(server.path, 'Overlay CS2 montado automaticamente antes do restart.');
  }

  await updateRuntimeStatus(id, 'restarting', 'apply-runtime-config', user, null, {
    label: 'A aplicar configuração',
    step: 'config',
    percent: 65
  });
  await applyGameConfigIfSupported(server, 'restart');

  const processResult = await startServerProcess(server);
  const result = await updateRuntimeStatus(id, 'online', 'restart-complete-real', user, processResult.pid);

  return {
    ok: true,
    action: 'restarted',
    pid: processResult.pid,
    item: result
  };
}

async function updateRuntimeStatus(id, status, action, user, pidOverride = undefined, progress = null) {
  const servers = await readServersIndex();
  const index = servers.findIndex((server) => server.id === id);

  if (index === -1 || !canAccessServer(servers[index], user)) {
    throw new Error('Servidor não encontrado');
  }

  const now = new Date().toISOString();
  const server = servers[index];

  server.status = status;
  server.updatedAt = now;

  const processInfo = await isServerProcessRunning(server);
  const finalPid = pidOverride !== undefined ? pidOverride : processInfo.pid;

  await writeJson(path.join(server.path, 'status.json'), {
    status,
    installStatus: server.installStatus || 'provisioned',
    pid: finalPid,
    processRunning: finalPid ? await isServerProcessRunning(server).then((info) => info.running) : false,
    lastAction: action,
    progress,
    updatedAt: now
  });

  await appendLog(server.path, `Ação executada por ${user.email}: ${action} → ${status}`);

  await addActivity({
    type: 'server.action',
    title: 'Ação no servidor',
    message: `${user.email}: ${action} → ${status} em ${server.name}`,
    actorId: user.id,
    actorEmail: user.email,
    actorRole: user.role,
    clientId: server.ownerId,
    serverId: server.id
  });

  servers[index] = server;
  await writeServersIndex(servers);

  return hydrateServer(server);
}

export async function getServerLogs(id, user) {
  const server = await getServer(id, user);

  if (!server) throw new Error('Servidor não encontrado');

  const logFile = path.join(server.path, 'logs', 'console.log');

  try {
    return (await fs.readFile(logFile, 'utf8')).split('\n').filter(Boolean).slice(-300);
  } catch {
    return [];
  }
}
