import express from 'express';
import fs from 'fs/promises';
import { exec } from 'child_process';

const router = express.Router();

const LOG_FILE = '/opt/xcat-panel/logs/cs2-update.log';
const MANIFEST = '/opt/xcat-panel/library/games/cs2/steamcmd/latest/steamapps/appmanifest_730.acf';

// helper exec
function execAsync(cmd) {
  return new Promise((resolve) => {
    exec(cmd, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: stdout?.trim(),
        stderr: stderr?.trim()
      });
    });
  });
}

// GET STATUS
router.get('/system/cs2-update-status', async (req, res) => {
  try {
    let log = '';
    let buildLocal = 'unknown';

    // ler log
    try {
      const raw = await fs.readFile(LOG_FILE, 'utf-8');
      log = raw.split('\n').slice(-40).join('\n');
    } catch {}

    // ler build local
    try {
      const manifest = await fs.readFile(MANIFEST, 'utf-8');
      const match = manifest.match(/"buildid"\s+"(\d+)"/);
      if (match) buildLocal = match[1];
    } catch {}

    return res.json({
      ok: true,
      buildLocal,
      log
    });

  } catch (err) {
    return res.json({ ok: false, error: err.message });
  }
});

// RUN UPDATE MANUAL
router.post('/system/cs2-update-run', async (req, res) => {
  try {
    const result = await execAsync('/opt/xcat-panel/scripts/auto-update-cs2-enterprise.sh');

    return res.json({
      ok: true,
      output: result.stdout || result.stderr || 'Executado'
    });

  } catch (err) {
    return res.json({ ok: false, error: err.message });
  }
});

export default router;
