import express from 'express';
import fs from 'fs';
import path from 'path';

const router = express.Router();

const ROOT = process.env.GAMEFORGE_ROOT || '/opt/xcat-panel';

function getLogPath(serverId) {
  return path.join(ROOT, 'servers', serverId, 'files', 'server.log');
}

function getCandidateLogPaths(serverId) {
  const serverPath = path.join(ROOT, 'servers', serverId);
  return [
    path.join(serverPath, 'logs', 'process.log'),
    path.join(serverPath, 'logs', 'console.log'),
    path.join(serverPath, 'files', 'server.log')
  ];
}

// GET logs (últimas linhas)
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ ok: false, error: 'ID em falta' });
    }

    const logPaths = getCandidateLogPaths(id);
    const chunks = [];

    for (const logPath of logPaths) {
      if (fs.existsSync(logPath)) {
        chunks.push(fs.readFileSync(logPath, 'utf8'));
      }
    }

    const logsDir = path.join(ROOT, 'servers', id, 'logs');
    if (fs.existsSync(logsDir)) {
      const tsLogs = fs.readdirSync(logsDir)
        .filter((name) => name.startsWith('ts3server_') && name.endsWith('.log'))
        .sort()
        .slice(-4);

      for (const name of tsLogs) {
        chunks.push(fs.readFileSync(path.join(logsDir, name), 'utf8'));
      }
    }

    if (chunks.length === 0) {
      return res.json({ ok: true, logs: [] });
    }

    const lines = chunks.join('\n').split('\n').slice(-300);

    res.json({
      ok: true,
      logs: lines,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

export default router;
