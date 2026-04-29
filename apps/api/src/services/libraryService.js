import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';

const ROOT = process.env.GAMEFORGE_ROOT || '/opt/gameforge';
const LIBRARY_DIR = path.join(ROOT, 'library');
const GAMES_DIR = path.join(LIBRARY_DIR, 'games');
const ARCHIVES_DIR = path.join(LIBRARY_DIR, 'archives');
const MANIFESTS_DIR = path.join(LIBRARY_DIR, 'manifests');
const LOGS_DIR = path.join(ROOT, 'logs');

const PAPER_API = 'https://api.papermc.io/v2';
const USER_AGENT = 'GameForgePanel/0.1.0 (admin@gameforge.local)';

async function ensureDirs() {
  await fs.mkdir(GAMES_DIR, { recursive: true });
  await fs.mkdir(ARCHIVES_DIR, { recursive: true });
  await fs.mkdir(MANIFESTS_DIR, { recursive: true });
  await fs.mkdir(LOGS_DIR, { recursive: true });
}

async function appendLibraryLog(message) {
  await fs.mkdir(LOGS_DIR, { recursive: true });
  await fs.appendFile(
    path.join(LOGS_DIR, 'library.log'),
    `[${new Date().toISOString()}] ${message}\n`
  );
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`PaperMC API falhou: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function downloadFile(url, destination) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT
    }
  });

  if (!response.ok) {
    throw new Error(`Download falhou: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(destination, buffer);
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', async (data) => {
      const text = data.toString();
      stdout += text;
      await appendLibraryLog(text.trim());
    });

    child.stderr?.on('data', async (data) => {
      const text = data.toString();
      stderr += text;
      await appendLibraryLog(text.trim());
    });

    child.on('error', reject);

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || stdout || `${command} terminou com código ${code}`));
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

async function runTarCreate(sourceDir, archivePath) {
  await runCommand('tar', ['-czf', archivePath, '-C', sourceDir, '.']);
}

async function fileSize(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.size;
  } catch {
    return 0;
  }
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function listLibraryItems() {
  await ensureDirs();

  const files = await fs.readdir(MANIFESTS_DIR);
  const items = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    try {
      const raw = await fs.readFile(path.join(MANIFESTS_DIR, file), 'utf8');
      items.push(JSON.parse(raw));
    } catch {
      continue;
    }
  }

  return items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function buildMinecraftPaperLibrary({ minecraftVersion = null } = {}) {
  await ensureDirs();

  await appendLibraryLog('A iniciar build library Minecraft Paper...');

  const project = await fetchJson(`${PAPER_API}/projects/paper`);
  const selectedVersion = minecraftVersion || project.versions.at(-1);

  const versionInfo = await fetchJson(`${PAPER_API}/projects/paper/versions/${selectedVersion}`);
  const latestBuild = versionInfo.builds.at(-1);

  const buildInfo = await fetchJson(`${PAPER_API}/projects/paper/versions/${selectedVersion}/builds/${latestBuild}`);
  const downloadName = buildInfo.downloads.application.name;

  const gameKey = `minecraft-java-paper-${selectedVersion}-${latestBuild}`;
  const gameDir = path.join(GAMES_DIR, 'minecraft-java', 'paper', selectedVersion, String(latestBuild));
  const archiveDir = path.join(ARCHIVES_DIR, 'minecraft-java', 'paper', selectedVersion);

  await fs.rm(gameDir, { recursive: true, force: true });
  await fs.mkdir(gameDir, { recursive: true });
  await fs.mkdir(archiveDir, { recursive: true });

  const downloadUrl = `${PAPER_API}/projects/paper/versions/${selectedVersion}/builds/${latestBuild}/downloads/${downloadName}`;
  const jarPath = path.join(gameDir, 'server.jar');

  await downloadFile(downloadUrl, jarPath);

  await fs.writeFile(path.join(gameDir, 'eula.txt'), 'eula=true\n');

  await fs.writeFile(path.join(gameDir, 'server.properties.template'), [
    'motd={{motd}}',
    'server-port={{port}}',
    'max-players={{maxPlayers}}',
    'online-mode={{onlineMode}}',
    'enable-rcon=false',
    'difficulty=normal',
    'gamemode=survival',
    'view-distance=10',
    'simulation-distance=10'
  ].join('\n') + '\n');

  await fs.writeFile(path.join(gameDir, 'start.sh.template'), [
    '#!/usr/bin/env bash',
    'cd "$(dirname "$0")"',
    'exec java -Xms512M -Xmx{{ramMb}}M -jar server.jar nogui'
  ].join('\n') + '\n');

  const archivePath = path.join(archiveDir, `${gameKey}.tar.gz`);

  await runTarCreate(gameDir, archivePath);

  const sizeBytes = await fileSize(archivePath);

  const manifest = {
    id: gameKey,
    game: 'minecraft-java',
    variant: 'paper',
    version: selectedVersion,
    build: latestBuild,
    source: 'papermc',
    downloadName,
    gameDir,
    archivePath,
    sizeBytes,
    sizeMb: Number((sizeBytes / 1024 / 1024).toFixed(2)),
    createdAt: new Date().toISOString()
  };

  await fs.writeFile(
    path.join(MANIFESTS_DIR, `${gameKey}.json`),
    JSON.stringify(manifest, null, 2)
  );

  await appendLibraryLog(`Library Minecraft Paper criada: ${gameKey}`);

  return manifest;
}

export async function buildCs2Library() {
  await ensureDirs();

  const game = 'cs2';
  const variant = 'steamcmd';
  const version = 'latest';
  const appId = '730';

  const gameKey = `cs2-steamcmd-latest`;
  const gameDir = path.join(GAMES_DIR, game, variant, version);
  const archiveDir = path.join(ARCHIVES_DIR, game, variant);

  await fs.mkdir(gameDir, { recursive: true });
  await fs.mkdir(archiveDir, { recursive: true });

  await appendLibraryLog('A iniciar download/validação CS2 via SteamCMD...');
  await appendLibraryLog(`Destino: ${gameDir}`);

  await runCommand('steamcmd', [
    '+force_install_dir',
    gameDir,
    '+login',
    'anonymous',
    '+app_update',
    appId,
    'validate',
    '+quit'
  ], {
    cwd: ROOT
  });

  const expectedGameDir = path.join(gameDir, 'game');

  if (!(await pathExists(expectedGameDir))) {
    throw new Error('SteamCMD terminou, mas a pasta game/ do CS2 não foi encontrada.');
  }

  const serverCfgDir = path.join(gameDir, 'game', 'csgo', 'cfg');
  await fs.mkdir(serverCfgDir, { recursive: true });

  await fs.writeFile(path.join(serverCfgDir, 'server.cfg.template'), [
    'hostname "{{serverName}}"',
    'sv_password "{{serverPassword}}"',
    'rcon_password "{{rconPassword}}"',
    'mp_limitteams 1',
    'mp_autoteambalance 1',
    'mp_maxrounds 24',
    'sv_cheats 0'
  ].join('\n') + '\n');

  await fs.writeFile(path.join(gameDir, 'start.sh.template'), [
    '#!/usr/bin/env bash',
    'cd "$(dirname "$0")"',
    'exec ./game/bin/linuxsteamrt64/cs2 -dedicated -usercon -console -port {{port}} +map {{map}} +game_type 0 +game_mode 1 +sv_setsteamaccount {{gslt}}'
  ].join('\n') + '\n');

  const archivePath = path.join(archiveDir, `${gameKey}.tar.gz`);

  await appendLibraryLog('A comprimir CS2 library. Pode demorar...');
  await runTarCreate(gameDir, archivePath);

  const sizeBytes = await fileSize(archivePath);

  const manifest = {
    id: gameKey,
    game,
    variant,
    version,
    appId,
    source: 'steamcmd',
    gameDir,
    archivePath,
    sizeBytes,
    sizeMb: Number((sizeBytes / 1024 / 1024).toFixed(2)),
    createdAt: new Date().toISOString()
  };

  await fs.writeFile(
    path.join(MANIFESTS_DIR, `${gameKey}.json`),
    JSON.stringify(manifest, null, 2)
  );

  await appendLibraryLog(`Library CS2 criada: ${gameKey} (${manifest.sizeMb} MB)`);

  return manifest;
}

export async function getLibraryItem(id) {
  await ensureDirs();

  const items = await listLibraryItems();
  return items.find((item) => item.id === id) || null;
}
