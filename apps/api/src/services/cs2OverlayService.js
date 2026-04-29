import fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const MOUNT_SCRIPT = '/opt/xcat-panel/apps/api/scripts/mount-cs2-overlay.sh';

export async function ensureCs2OverlayMounted(server) {
  if (!server || server.game !== 'cs2') {
    return { mounted: false, skipped: true };
  }

  await fs.access(MOUNT_SCRIPT);

  const { stdout, stderr } = await execFileAsync('bash', [MOUNT_SCRIPT, server.id], {
    timeout: 120000,
    maxBuffer: 1024 * 1024
  });

  return {
    mounted: true,
    skipped: false,
    stdout,
    stderr
  };
}
