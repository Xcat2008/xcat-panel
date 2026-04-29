import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import templates from '../data/templates.js';

const execFileAsync = promisify(execFile);
const router = express.Router();

const SERVERS_ROOT = '/opt/xcat-panel/servers';

function serverRoot(serverId) {
  return path.join(SERVERS_ROOT, serverId);
}

function consolePipePath(serverId) {
  return path.join(serverRoot(serverId), 'files', 'console.pipe');
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function sendPipeCommand(serverId, command) {
  const pipe = consolePipePath(serverId);

  if (!(await exists(pipe))) {
    throw new Error(`console.pipe não existe em ${pipe}`);
  }

  await execFileAsync(
    'timeout',
    ['3', 'bash', '-lc', 'printf "%s\n" "$1" > "$2"', 'gameforge-template', command, pipe],
    { timeout: 5000 }
  );
}

router.get('/templates', async (req, res) => {
  return res.json({
    ok: true,
    items: templates
  });
});

router.post('/servers/:serverId/apply-template', async (req, res) => {
  try {
    const templateId = String(req.body?.templateId || '').trim();
    const template = templates.find((item) => item.id === templateId);

    if (!template) {
      return res.status(404).json({
        ok: false,
        error: 'Template não encontrado.'
      });
    }

    const commands = template.install?.commands || [];

    for (const command of commands) {
      await sendPipeCommand(req.params.serverId, command);
    }

    return res.json({
      ok: true,
      templateId: template.id,
      name: template.name,
      commands
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || 'Erro ao aplicar template.'
    });
  }
});

export default router;
