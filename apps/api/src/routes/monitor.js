import { Router } from 'express';
import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

const router = Router();
const ROOT = process.env.GAMEFORGE_ROOT || '/opt/xcat-panel';
const DATA_FILE = path.join(ROOT, 'data', 'servers.json');

function exec(cmd) {
  return new Promise((resolve) => {
    execFile('bash', ['-lc', cmd], { encoding: 'utf8' }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

async function readServers() {
  return JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
}

function allowed(server, user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return server.ownerId === user.id || server.ownerEmail === user.email;
}

async function getPids(server) {
  const pids = [];

  if (Array.isArray(server.runtime?.pids)) pids.push(...server.runtime.pids);
  if (server.runtime?.pid) pids.push(server.runtime.pid);

  const port = Number(server.installConfig?.port || server.ports?.[0]?.port || 0);

  if (port) {
    const byPort = await exec(`ss -H -tulnp 2>/dev/null | grep ':${port}\\b' || true`);
    for (const match of byPort.stdout.matchAll(/pid=(\d+)/g)) {
      pids.push(Number(match[1]));
    }
  }

  return [...new Set(pids.map(Number).filter(Boolean))];
}

router.get('/:id', async (req, res) => {
  try {
    const servers = await readServers();
    const server = servers.find((item) => item.id === req.params.id);

    if (!server) {
      return res.status(404).json({ ok: false, error: 'Servidor não encontrado' });
    }

    if (!allowed(server, req.user)) {
      return res.status(403).json({ ok: false, error: 'Sem permissão' });
    }

    const pids = await getPids(server);

    if (!pids.length) {
      return res.json({
        ok: true,
        item: {
          online: false,
          pids: [],
          cpuPercent: 0,
          ramMb: 0,
          ramPercent: 0
        }
      });
    }

    const ps = await exec(`ps -o pid=,pcpu=,rss= -p ${pids.join(',')} 2>/dev/null || true`);

    let cpuPercent = 0;
    let ramKb = 0;
    const alivePids = [];

    for (const line of ps.stdout.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3) {
        alivePids.push(Number(parts[0]));
        cpuPercent += Number(parts[1]) || 0;
        ramKb += Number(parts[2]) || 0;
      }
    }

    const ramMb = Math.round((ramKb / 1024) * 10) / 10;
    const limitMb = Number(server.resources?.ramMb || 0);
    const ramPercent = limitMb ? Math.round((ramMb / limitMb) * 1000) / 10 : 0;

    res.json({
      ok: true,
      item: {
        online: alivePids.length > 0,
        pids: alivePids,
        cpuPercent: Math.round(cpuPercent * 10) / 10,
        ramMb,
        ramPercent
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

export default router;
