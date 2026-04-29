import fs from 'fs/promises';
import { spawn } from 'child_process';

const SCRIPT = '/opt/gameforge/scripts/auto-update-cs2-enterprise.sh';
const LOG_FILE = '/opt/gameforge/logs/cs2-update.log';

export async function startCs2Update(user) {
  if (user?.role !== 'admin') {
    throw new Error('Só o admin pode executar updates');
  }

  const proc = spawn('bash', [SCRIPT], {
    detached: true,
    stdio: 'ignore'
  });

  proc.unref();

  return {
    started: true,
    pid: proc.pid
  };
}

export async function getCs2UpdateLogs(user) {
  if (user?.role !== 'admin') {
    throw new Error('Só o admin pode ver logs de update');
  }

  try {
    const raw = await fs.readFile(LOG_FILE, 'utf-8');

    const clean = raw
      .replace(/\u001b\[[0-9;]*m/g, '') // remove ANSI colors
      .split('\n')
      .filter(Boolean)
      .slice(-200);

    return clean;
  } catch {
    return [];
  }
}

export async function getCs2UpdateStatus(user) {
  if (user?.role !== 'admin') {
    throw new Error('Só o admin pode ver estado de update');
  }

  try {
    const raw = await fs.readFile(LOG_FILE, 'utf-8');

    const lines = raw
      .replace(/\u001b\[[0-9;]*m/g, '')
      .split('\n')
      .filter(Boolean)
      .slice(-80);

    const lastLine = lines[lines.length - 1] || '';

    const running =
      lines.some(l => l.includes('AUTO UPDATE START')) &&
      !lastLine.includes('[OK]') &&
      !lastLine.includes('[DONE]') &&
      !lastLine.includes('Nada a fazer');

    return {
      running,
      lastLine,
      logs: lines
    };
  } catch {
    return {
      running: false,
      lastLine: '',
      logs: []
    };
  }
}
