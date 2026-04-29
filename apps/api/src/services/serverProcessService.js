import fs from 'fs/promises';
import path from 'path';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

function pidFile(server) {
  return path.join(server.path, 'server.pid');
}

async function isPidAlive(pid) {
  if (!pid) return false;

  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (err) {
    if (err?.code === 'EPERM') return true;
    return false;
  }
}

async function findPidsByPorts(server) {
  const pids = new Set();

  for (const item of server.ports || []) {
    const port = Number(item.port);
    if (!port) continue;

    const protocols = String(item.protocol || 'tcp').includes('/')
      ? ['tcp', 'udp']
      : [String(item.protocol || 'tcp').toLowerCase()];

    for (const protocol of protocols) {
      try {
        const { stdout, stderr } = await execFileAsync('fuser', ['-n', protocol, String(port)], { timeout: 5000 });
        `${stdout}\n${stderr}`.split(/\s+/).forEach((value) => {
          const pid = Number(value.replace(/\D/g, ''));
          if (Number.isFinite(pid) && pid > 0) pids.add(pid);
        });
      } catch (err) {
        `${err?.stdout || ''}\n${err?.stderr || ''}`.split(/\s+/).forEach((value) => {
          const pid = Number(value.replace(/\D/g, ''));
          if (Number.isFinite(pid) && pid > 0) pids.add(pid);
        });
      }
    }
  }

  return [...pids];
}

export async function readServerPid(server) {
  try {
    const raw = await fs.readFile(pidFile(server), 'utf8');
    const pid = Number(raw.trim());
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

export async function isServerProcessRunning(server) {
  const pid = await readServerPid(server);
  const pidRunning = await isPidAlive(pid);

  if (!pidRunning) {
    const portPids = await findPidsByPorts(server);

    return {
      pid: portPids[0] || pid,
      running: portPids.length > 0
    };
  }

  return {
    pid,
    running: true
  };
}

export async function startServerProcess(server) {
  const existing = await isServerProcessRunning(server);

  if (existing.running) {
    return {
      started: false,
      alreadyRunning: true,
      pid: existing.pid
    };
  }

  const filesDir = path.join(server.path, 'files');
  const startScript = path.join(filesDir, 'start.sh');
  const logPath = path.join(server.path, 'logs', 'process.log');

  await fs.access(startScript);
  await fs.mkdir(path.dirname(logPath), { recursive: true });

  const launchScript = 'cd "$1" && setsid /usr/bin/env bash "$2" >> "$3" 2>&1 < /dev/null & echo $!';

  const child = spawn('/bin/sh', ['-c', launchScript, 'gameforge-launch', filesDir, startScript, logPath], {
    cwd: filesDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GAMEFORGE_SERVER_ID: server.id,
      GAMEFORGE_SERVER_PATH: server.path
    }
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const exitCode = await new Promise((resolve) => {
    child.on('close', resolve);
  });

  if (exitCode !== 0) {
    throw new Error(`Falha ao arrancar servidor: ${stderr.trim() || `exit ${exitCode}`}`);
  }

  const pid = Number(stdout.trim().split(/\s+/).pop());

  if (!Number.isFinite(pid)) {
    throw new Error('Falha ao obter PID do servidor iniciado');
  }

  await fs.writeFile(pidFile(server), String(pid));

  return {
    started: true,
    alreadyRunning: false,
    pid
  };
}

export async function stopServerProcess(server) {
  const existing = await isServerProcessRunning(server);

  if (!existing.pid) {
    const portPids = await findPidsByPorts(server);

    if (portPids.length > 0) {
      for (const pid of portPids) {
        try {
          process.kill(-pid, 'SIGTERM');
        } catch {
          try {
            process.kill(pid, 'SIGTERM');
          } catch {}
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 1500));

      for (const pid of portPids) {
        if (await isPidAlive(pid)) {
          try {
            process.kill(-pid, 'SIGKILL');
          } catch {
            try {
              process.kill(pid, 'SIGKILL');
            } catch {}
          }
        }
      }

      await fs.rm(pidFile(server), { force: true });

      return {
        stopped: true,
        wasRunning: true,
        pid: portPids[0],
        killedByPort: true
      };
    }

    return {
      stopped: false,
      wasRunning: false,
      pid: null
    };
  }

  if (!existing.running) {
    await fs.rm(pidFile(server), { force: true });

    return {
      stopped: false,
      wasRunning: false,
      pid: existing.pid
    };
  }

  try {
    process.kill(-existing.pid, 'SIGTERM');
  } catch {
    try {
      process.kill(existing.pid, 'SIGTERM');
    } catch {}
  }

  await new Promise((resolve) => setTimeout(resolve, 1500));

  const stillRunning = await isPidAlive(existing.pid);

  if (stillRunning) {
    try {
      process.kill(-existing.pid, 'SIGKILL');
    } catch {
      try {
        process.kill(existing.pid, 'SIGKILL');
      } catch {}
    }
  }

  await fs.rm(pidFile(server), { force: true });

  return {
    stopped: true,
    wasRunning: true,
    pid: existing.pid,
    killed: stillRunning
  };
}
