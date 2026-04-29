import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const router = express.Router();

const SERVERS_ROOT = '/opt/xcat-panel/servers';

function serverRoot(serverId) {
  return path.join(SERVERS_ROOT, serverId);
}

function consolePipePath(serverId) {
  return path.join(serverRoot(serverId), 'files', 'console.pipe');
}

function serverLogPath(serverId) {
  return path.join(serverRoot(serverId), 'files', 'server.log');
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function safeCommand(command) {
  return String(command || '')
    .replace(/\r/g, '')
    .replace(/\n/g, ' ')
    .trim();
}

function cleanPlayerName(value) {
  return String(value || '')
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/[<>"]/g, '')
    .trim();
}

function playerNameKey(value) {
  return cleanPlayerName(value).toLowerCase();
}

function upsertPlayer(players, player) {
  const name = cleanPlayerName(player.name);
  if (!name || /^bot$/i.test(player.steamId || '')) return;

  const nameKey = playerNameKey(name);
  let key = null;

  for (const [candidateKey, current] of players.entries()) {
    if (playerNameKey(current.name) === nameKey) {
      key = candidateKey;
      break;
    }
  }

  key ||= player.steamId || player.userId || name;

  const current = players.get(key) || {};
  const merged = { ...current, ...player, key, name };

  if (player.steamId && key !== player.steamId) {
    players.delete(key);
    merged.key = player.steamId;
    players.set(player.steamId, merged);
    return;
  }

  players.set(key, merged);
}

function removePlayer(players, line) {
  const patterns = [
    /(?:Dropped client|Disconnect client|Netchan)\s+'([^']+)'/i,
    /^(.+?) kicked by Console/i,
    /Steam Net connection .*?'([^']+)'.*closed/i,
    /\[#[^\]]+\s+'([^']+)'\]\s+closed/i
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (!match) continue;

    const name = cleanPlayerName(match[1]);
    for (const [key, player] of players.entries()) {
      if (playerNameKey(player.name) === playerNameKey(name)) players.delete(key);
    }
  }
}

function parsePlayersFromLogs(logs) {
  const players = new Map();

  for (const line of logs) {
    removePlayer(players, line);

    let match = line.match(/CServerSideClientBase::Connect\( name='([^']+)', userid=(\d+)/i);
    if (match) {
      upsertPlayer(players, { name: match[1], userId: match[2] });
      continue;
    }

    match = line.match(/Client #(\d+)\s+"([^"]+)"\s+connected/i);
    if (match) {
      upsertPlayer(players, { name: match[2], userId: match[1] });
      continue;
    }

    match = line.match(/SV:\s+"([^"<]+)<(\d+)><([^>]+)>/i);
    if (match && !/BOT|STEAM_ID_PENDING/i.test(match[3])) {
      upsertPlayer(players, { name: match[1], userId: match[2], steamId: match[3] });
      continue;
    }

    match = line.match(/\[MatchZy\].*Player ID:\s*(\d+),\s*Name:\s*(.+?)\s+has connected/i);
    if (match) {
      upsertPlayer(players, { name: match[2], userId: match[1] });
      continue;
    }

    match = line.match(/Client\s+(\d+)\s+'([^']+)'\s+signon state .*SIGNONSTATE_FULL/i);
    if (match) {
      upsertPlayer(players, { name: match[2], userId: match[1] });
    }
  }

  return Array.from(players.values()).filter((player) => player.name);
}

async function writeConsoleCommand(serverId, command) {
  const pipe = consolePipePath(serverId);
  const finalCommand = safeCommand(command);

  if (!finalCommand) {
    throw new Error('Comando vazio.');
  }

  if (!(await exists(pipe))) {
    throw new Error(`console.pipe não existe em ${pipe}`);
  }

  await execFileAsync(
    'timeout',
    ['3', 'bash', '-lc', 'printf "%s\n" "$1" > "$2"', 'gameforge-write-pipe', finalCommand, pipe],
    {
      timeout: 5000
    }
  );

  return `Comando enviado: ${finalCommand}`;
}

router.get('/servers/:serverId/live-control', async (req, res) => {
  try {
    const pipe = consolePipePath(req.params.serverId);
    const ready = await exists(pipe);

    return res.json({
      ok: true,
      item: {
        mode: 'console-pipe',
        ready,
        configured: ready,
        available: ready,
        enabled: ready,
        connected: ready,
        rconConfigured: ready,
        rcon: ready ? 'Configurado' : 'A verificar...',
        host: ready ? 'console.pipe' : 'console.pipe',
        port: ready ? 'stdin' : 'stdin',
        status: ready ? 'Pronto' : 'Indisponível'
      }
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || 'Erro ao verificar Live Control'
    });
  }
});

router.get('/servers/:serverId/live-control/players', async (req, res) => {
  try {
    const logPath = serverLogPath(req.params.serverId);

    if (!(await exists(logPath))) {
      return res.json({ ok: true, items: [] });
    }

    const data = await fs.readFile(logPath, 'utf8');
    const logs = data.split('\n').slice(-600);
    const items = parsePlayersFromLogs(logs);

    return res.json({
      ok: true,
      items
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || 'Erro ao listar jogadores CS2'
    });
  }
});

router.post('/servers/:serverId/live-control/command', async (req, res) => {
  try {
    const command = safeCommand(req.body?.command);

    if (!command) {
      return res.status(400).json({
        ok: false,
        error: 'Nenhum comando válido fornecido.'
      });
    }

    const output = await writeConsoleCommand(req.params.serverId, command);

    return res.json({
      ok: true,
      command,
      output
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: `Erro Console Pipe: ${err.message}`
    });
  }
});

router.post('/servers/:serverId/live-control/change-map', async (req, res) => {
  try {
    const map = safeCommand(req.body?.map);

    if (!map || !/^de_[a-z0-9_]+$/i.test(map)) {
      return res.status(400).json({
        ok: false,
        error: 'Mapa inválido.'
      });
    }

    const command = `changelevel ${map}`;
    const output = await writeConsoleCommand(req.params.serverId, command);

    return res.json({
      ok: true,
      map,
      command,
      output
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: `Erro ao mudar mapa: ${err.message}`
    });
  }
});

export default router;
