import fs from 'fs/promises';
import path from 'path';
import { spawn, execFile } from 'child_process';

const ROOT = process.env.GAMEFORGE_ROOT || '/opt/gameforge';
const DATA_FILE = path.join(ROOT, 'data', 'servers.json');

function exec(cmd) {
  return new Promise((resolve) => {
    execFile('bash', ['-lc', cmd], { encoding: 'utf8' }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

function requireServer(server) {
  if (!server?.id) throw new Error('Servidor inválido: id em falta');
}

function getServerPath(server) {
  requireServer(server);
  return server.path || path.join(ROOT, 'servers', server.id);
}

function getFilesDir(server) {
  return path.join(getServerPath(server), 'files');
}

function getStartScript(server) {
  return path.join(getFilesDir(server), 'start.sh');
}

function getPort(server) {
  return Number(server?.installConfig?.port || server?.ports?.[0]?.port || 0);
}

async function readServers() {
  return JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
}

async function writeServers(items) {
  await fs.writeFile(DATA_FILE, JSON.stringify(items, null, 2));
}

async function updateServerRuntime(serverId, runtimePatch, status) {
  const items = await readServers();
  const index = items.findIndex((item) => item.id === serverId);
  if (index === -1) return null;

  const current = items[index];

  items[index] = {
    ...current,
    path: current.path || path.join(ROOT, 'servers', current.id),
    status,
    updatedAt: new Date().toISOString(),
    runtime: {
      ...(current.runtime || {}),
      ...runtimePatch,
      status,
      updatedAt: new Date().toISOString()
    }
  };

  await writeServers(items);
  return items[index];
}

async function findPidsByPort(port) {
  if (!port) return [];

  const result = await exec(`ss -H -tulnp 2>/dev/null | grep ':${port}\\b' || true`);
  const matches = [...result.stdout.matchAll(/pid=(\d+)/g)];

  return [...new Set(matches.map((m) => Number(m[1])).filter(Boolean))];
}

async function findPidsByExactCwd(server) {
  const filesDir = getFilesDir(server);

  const result = await exec(`
    for p in /proc/[0-9]*; do
      pid="$(basename "$p")"
      cwd="$(readlink -f "$p/cwd" 2>/dev/null || true)"
      cmd="$(tr '\\0' ' ' < "$p/cmdline" 2>/dev/null || true)"

      if [ "$cwd" = "${filesDir}" ]; then
        case "$cmd" in
          *linuxsteamrt64/cs2*|*server.jar*|*start.sh*) echo "$pid" ;;
        esac
      fi
    done
  `);

  return [...new Set(
    result.stdout
      .split('\n')
      .map((x) => Number(x.trim()))
      .filter(Boolean)
  )];
}

async function getRealPids(server) {
  requireServer(server);

  const port = getPort(server);
  const byPort = await findPidsByPort(port);
  const byCwd = await findPidsByExactCwd(server);

  return [...new Set([...byPort, ...byCwd])];
}

export async function isServerRunning(server) {
  const pids = await getRealPids(server);

  return {
    running: pids.length > 0,
    pid: pids[0] || null,
    pids
  };
}

export async function startServer(server) {
  requireServer(server);

  const real = await isServerRunning(server);

  if (real.running) {
    await updateServerRuntime(server.id, {
      pid: real.pid,
      pids: real.pids,
      lastAction: 'start-detected-existing'
    }, 'online');

    throw new Error('Servidor já está em execução');
  }

  const startScript = getStartScript(server);
  const filesDir = getFilesDir(server);

  await fs.access(startScript);

  const child = spawn('bash', [startScript], {
    cwd: filesDir,
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: {
      ...process.env,
      GAMEFORGE_SERVER_ID: server.id,
      GAMEFORGE_SERVER_FILES: filesDir
    }
  });

  child.unref();

  await updateServerRuntime(server.id, {
    pid: child.pid,
    pids: [child.pid],
    lastAction: 'start'
  }, 'starting');

  setTimeout(async () => {
    try {
      const servers = await readServers();
      const fresh = servers.find((item) => item.id === server.id) || server;
      const after = await isServerRunning(fresh);

      await updateServerRuntime(server.id, {
        pid: after.pid,
        pids: after.pids,
        lastAction: after.running ? 'start-complete' : 'start-failed'
      }, after.running ? 'online' : 'offline');
    } catch {}
  }, 7000);

  return { ok: true, pid: child.pid };
}

export async function stopServer(server) {
  requireServer(server);

  const real = await isServerRunning(server);

  if (!real.running) {
    await updateServerRuntime(server.id, {
      pid: null,
      pids: [],
      lastAction: 'stop-detected-offline'
    }, 'offline');

    throw new Error('Servidor não está em execução');
  }

  for (const pid of real.pids) {
    await exec(`kill ${pid} 2>/dev/null || true`);
  }

  await new Promise((resolve) => setTimeout(resolve, 4000));

  const still = await isServerRunning(server);

  for (const pid of still.pids) {
    await exec(`kill -9 ${pid} 2>/dev/null || true`);
  }

  await updateServerRuntime(server.id, {
    pid: null,
    pids: [],
    lastAction: 'stop'
  }, 'offline');

  return { ok: true };
}

export async function restartServer(server) {
  requireServer(server);

  const real = await isServerRunning(server);

  if (real.running) {
    try {
      await stopServer(server);
    } catch {}
  }

  await new Promise((resolve) => setTimeout(resolve, 1500));

  return startServer(server);
}

export async function refreshServerRuntime(server) {
  requireServer(server);

  const real = await isServerRunning(server);

  const updated = await updateServerRuntime(server.id, {
    pid: real.pid,
    pids: real.pids,
    lastAction: 'refresh'
  }, real.running ? 'online' : 'offline');

  return updated || {
    ...server,
    path: getServerPath(server),
    status: real.running ? 'online' : 'offline',
    runtime: {
      status: real.running ? 'online' : 'offline',
      pid: real.pid,
      pids: real.pids,
      lastAction: 'refresh'
    }
  };
}
