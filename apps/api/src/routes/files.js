import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { getServer } from '../services/serverService.js';

const router = Router();

function safeJoin(base, target = '') {
  const resolved = path.resolve(base, target);
  if (!resolved.startsWith(path.resolve(base))) {
    throw new Error('Caminho inválido');
  }
  return resolved;
}

router.get('/:serverId', async (req, res) => {
  try {
    const server = await getServer(req.params.serverId, req.user);
    if (!server) return res.status(404).json({ ok: false, error: 'Servidor não encontrado' });

    const base = path.join(server.path, 'files');
    const currentPath = safeJoin(base, req.query.path || '');
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    res.json({
      ok: true,
      path: req.query.path || '',
      items: entries.map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'special',
        readable: entry.isDirectory() || entry.isFile()
      }))
    });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

router.get('/:serverId/read', async (req, res) => {
  try {
    const server = await getServer(req.params.serverId, req.user);
    if (!server) return res.status(404).json({ ok: false, error: 'Servidor não encontrado' });

    const base = path.join(server.path, 'files');
    const filePath = safeJoin(base, req.query.path || '');
    const stats = await fs.lstat(filePath);

    if (!stats.isFile()) {
      return res.status(400).json({
        ok: false,
        error: 'Este item não é um ficheiro normal e não pode ser lido no painel.'
      });
    }

    if (stats.size > 1024 * 1024) {
      return res.status(400).json({
        ok: false,
        error: 'Ficheiro demasiado grande para abrir no painel.'
      });
    }

    const content = await fs.readFile(filePath, 'utf8');

    res.json({ ok: true, content });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

router.post('/:serverId/write', async (req, res) => {
  try {
    const server = await getServer(req.params.serverId, req.user);
    if (!server) return res.status(404).json({ ok: false, error: 'Servidor não encontrado' });

    const base = path.join(server.path, 'files');
    const filePath = safeJoin(base, req.body.path || '');
    let stats = null;

    try {
      stats = await fs.lstat(filePath);
    } catch {}

    if (stats && !stats.isFile()) {
      return res.status(400).json({
        ok: false,
        error: 'Este item não é um ficheiro normal e não pode ser editado no painel.'
      });
    }

    await fs.writeFile(filePath, req.body.content || '');

    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

export default router;
