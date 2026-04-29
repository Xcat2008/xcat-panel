import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { getServer } from '../services/serverService.js';

const ROOT = process.env.GAMEFORGE_ROOT || '/opt/xcat-panel';
const BACKUPS_DIR = path.join(ROOT, 'backups');

const router = Router();

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function serverBackupDir(serverId) {
  return path.join(BACKUPS_DIR, serverId);
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);

    let stderr = '';

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', reject);

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `${command} terminou com código ${code}`));
        return;
      }

      resolve();
    });
  });
}

async function getFileSize(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.size;
  } catch {
    return 0;
  }
}

router.get('/:serverId', async (req, res) => {
  try {
    const server = await getServer(req.params.serverId, req.user);

    if (!server) {
      return res.status(404).json({
        ok: false,
        error: 'Servidor não encontrado'
      });
    }

    const dir = serverBackupDir(server.id);
    await ensureDir(dir);

    const entries = await fs.readdir(dir, { withFileTypes: true });
    const items = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const metaPath = path.join(dir, entry.name, 'backup.json');

      try {
        const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
        items.push(meta);
      } catch {
        continue;
      }
    }

    items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({
      ok: true,
      items
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

router.post('/:serverId', async (req, res) => {
  try {
    const server = await getServer(req.params.serverId, req.user);

    if (!server) {
      return res.status(404).json({
        ok: false,
        error: 'Servidor não encontrado'
      });
    }

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const backupPath = path.join(serverBackupDir(server.id), id);
    const archiveName = 'files.tar.gz';
    const archivePath = path.join(backupPath, archiveName);

    await ensureDir(backupPath);

    await runCommand('tar', [
      '-czf',
      archivePath,
      '-C',
      path.join(server.path, 'files'),
      '.'
    ]);

    const sizeBytes = await getFileSize(archivePath);

    const meta = {
      id,
      serverId: server.id,
      serverName: server.name,
      createdBy: req.user.email,
      createdByRole: req.user.role,
      createdAt,
      path: backupPath,
      archive: archiveName,
      sizeBytes,
      sizeMb: Number((sizeBytes / 1024 / 1024).toFixed(2)),
      type: 'compressed-snapshot'
    };

    await fs.writeFile(path.join(backupPath, 'backup.json'), JSON.stringify(meta, null, 2));

    res.status(201).json({
      ok: true,
      item: meta
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message
    });
  }
});

router.post('/:serverId/:backupId/restore', async (req, res) => {
  try {
    const server = await getServer(req.params.serverId, req.user);

    if (!server) {
      return res.status(404).json({
        ok: false,
        error: 'Servidor não encontrado'
      });
    }

    const backupPath = path.join(serverBackupDir(server.id), req.params.backupId);
    const archivePath = path.join(backupPath, 'files.tar.gz');

    await fs.access(archivePath);

    await fs.rm(path.join(server.path, 'files'), {
      recursive: true,
      force: true
    });

    await fs.mkdir(path.join(server.path, 'files'), {
      recursive: true
    });

    await runCommand('tar', [
      '-xzf',
      archivePath,
      '-C',
      path.join(server.path, 'files')
    ]);

    res.json({
      ok: true,
      restored: true
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message
    });
  }
});

router.delete('/:serverId/:backupId', async (req, res) => {
  try {
    const server = await getServer(req.params.serverId, req.user);

    if (!server) {
      return res.status(404).json({
        ok: false,
        error: 'Servidor não encontrado'
      });
    }

    const backupPath = path.join(serverBackupDir(server.id), req.params.backupId);

    await fs.rm(backupPath, {
      recursive: true,
      force: true
    });

    res.json({
      ok: true,
      deleted: true
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message
    });
  }
});

export default router;
